import { spawnSync } from "node:child_process";
import { unzipSync, zipSync } from "fflate";
import {
  LIMITS,
  StikSoundError,
  assertSafeZipEntryPath,
  computeSquareCrop,
  type AudioProbeInfo,
  type ImageProbeInfo,
  type PcmMono48k,
  type PeakBuckets,
  type RgbaFrame512,
  type StickerEdit,
  type VideoRenderRequest,
  type VideoRenderResult,
  type ZipEntryInput
} from "@stiksound/core";
import {
  computePeaksFromFloat32,
  decodeWavToMonoFloat32,
  encodeWavBytes,
  sniffAudioContainer,
  sniffImageHeader,
  sniffVideoContainer,
  trimPcmSamples
} from "@stiksound/media-web";
import {
  encodeWebpUnderLimit,
  resolveBinaries,
  runBinary,
  type CliMediaEngine,
  type DecodedAudio,
  type FfmpegBinaries
} from "../src/engine";

export const binaries = resolveBinaries();
export const hasFfmpeg =
  spawnSync(binaries.ffmpeg, ["-version"], { stdio: "ignore" }).status === 0 &&
  spawnSync(binaries.ffprobe, ["-version"], { stdio: "ignore" }).status === 0;

/** Runs ffmpeg with synthetic lavfi inputs and captures stdout bytes. */
export async function synth(args: string[]): Promise<Uint8Array> {
  const result = await runBinary(binaries.ffmpeg, ["-v", "error", ...args, "pipe:1"], { timeoutMs: 60_000 });
  return result.stdout;
}

export function pngFixture(width: number, height: number, alpha = false): Promise<Uint8Array> {
  const source = alpha
    ? `color=c=black@0.0:size=${width}x${height}:rate=1,format=rgba,geq=r='if(gt(X,W/2),220,0)':g=40:b=60:a='if(gt(X,W/2),255,0)'`
    : `testsrc2=size=${width}x${height}:rate=1`;
  return synth(["-f", "lavfi", "-i", source, "-frames:v", "1", "-f", "image2pipe", "-c:v", "png"]);
}

export function gifFixture(width: number, height: number, seconds: number): Promise<Uint8Array> {
  return synth(["-f", "lavfi", "-i", `testsrc=size=${width}x${height}:rate=10`, "-t", String(seconds), "-f", "gif"]);
}

export function wavFixture(seconds: number, frequency = 440): Promise<Uint8Array> {
  return synth(["-f", "lavfi", "-i", `sine=frequency=${frequency}:sample_rate=48000`, "-t", String(seconds), "-f", "wav"]);
}

export function mp3Fixture(seconds: number, frequency = 440): Promise<Uint8Array> {
  return synth([
    "-f", "lavfi", "-i", `sine=frequency=${frequency}:sample_rate=44100`,
    "-t", String(seconds), "-ac", "2", "-b:a", "128k", "-f", "mp3"
  ]);
}

export function lateToneMp3(totalSeconds: number, toneStartSeconds: number): Promise<Uint8Array> {
  const silence = `anullsrc=r=44100:cl=mono:d=${toneStartSeconds}`;
  const tone = `sine=frequency=440:sample_rate=44100:duration=${totalSeconds - toneStartSeconds}`;
  return synth([
    "-f", "lavfi", "-i", silence,
    "-f", "lavfi", "-i", tone,
    "-filter_complex", "[0][1]concat=n=2:v=0:a=1[a]", "-map", "[a]",
    "-b:a", "96k", "-f", "mp3"
  ]);
}

/** Builds a minimal valid PNG header (dimensions + color type) for fast headless unit tests. */
export function makeTinyPng(width: number, height: number, withAlpha = true): Uint8Array {
  const buf = new Uint8Array(33);
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(buf.buffer);
  view.setUint32(8, 13, false); // IHDR length
  buf.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  buf[24] = 8; // bit depth
  buf[25] = withAlpha ? 6 : 2; // RGBA vs RGB
  return buf;
}

/** Builds a minimal valid MP4 ftyp header for fast headless unit tests. */
export function makeTinyMp4(): Uint8Array {
  const buf = new Uint8Array(24);
  const view = new DataView(buf.buffer);
  view.setUint32(0, 20, false);
  buf.set([0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d], 4); // ftypisom
  return buf;
}

/** Builds a real 16-bit PCM WAV with optional leading silence and a sine tone. */
export function makeToneWav(durationMs: number, options: { silenceMs?: number; sampleRate?: number } = {}): Uint8Array {
  const sampleRate = options.sampleRate ?? 48000;
  const totalSamples = Math.round((durationMs / 1000) * sampleRate);
  const silenceSamples = Math.round(((options.silenceMs ?? 0) / 1000) * sampleRate);
  const samples = new Float32Array(totalSamples);
  for (let i = silenceSamples; i < totalSamples; i++) {
    samples[i] = 0.6 * Math.sin((2 * Math.PI * 440 * i) / sampleRate);
  }
  return encodeWavBytes({ sampleRate: 48000, channels: 1, samples, durationMs });
}

/**
 * Deterministic in-memory CliMediaEngine so CLI & MCP tests run fast on macOS/Windows/Linux
 * even when FFmpeg is not installed on the test machine.
 */
export class FakeCliEngine implements CliMediaEngine {
  public lastVideoRequest: VideoRenderRequest | null = null;
  public videoHasSound = true;
  public videoDurationMs = 3000;
  public simulatedTruncatedDurationMs: number | null = null;

  constructor(private readonly fakeBinaries: FfmpegBinaries = { ffmpeg: "ffmpeg", ffprobe: "ffprobe" }) {}

  public getBinaries(): FfmpegBinaries {
    return this.fakeBinaries;
  }

  public async probeImage(bytes: Uint8Array): Promise<ImageProbeInfo> {
    const videoFormat = sniffVideoContainer(bytes);
    if (videoFormat) {
      return {
        format: videoFormat,
        width: 320,
        height: 240,
        has_alpha: false,
        animated: true,
        frame_count: Math.round((this.videoDurationMs / 1000) * 15),
        duration_ms: this.videoDurationMs
      };
    }
    return sniffImageHeader(bytes);
  }

  public async renderSticker(bytes: Uint8Array, _edit: StickerEdit): Promise<RgbaFrame512> {
    const info = await this.probeImage(bytes);
    const { outputSize } = computeSquareCrop(info.width, info.height);
    const data = new Uint8Array(outputSize * outputSize * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 200;
      data[i + 1] = 100;
      data[i + 2] = 50;
      data[i + 3] = 255;
    }
    return { width: outputSize, height: outputSize, data };
  }

  public async encodeWebp(frame: RgbaFrame512): Promise<Uint8Array> {
    return encodeWebpUnderLimit(frame);
  }

  public async decodeAudio(bytes: Uint8Array): Promise<DecodedAudio> {
    const header = sniffAudioContainer(bytes);
    let samples: Float32Array;
    if (header.format === "wav") {
      const decoded = decodeWavToMonoFloat32(bytes);
      samples = decoded.samples;
    } else {
      // Synthetic 4-second tone for non-WAV fixtures (e.g. fake MP3 bytes in unit tests).
      samples = new Float32Array(48000 * 4);
      for (let i = 0; i < samples.length; i++) {
        samples[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / 48000);
      }
    }
    const durationMs = Math.round((samples.length / 48000) * 1000);
    const truncated = this.simulatedTruncatedDurationMs !== null && this.simulatedTruncatedDurationMs > durationMs;
    return {
      samples,
      sampleRate: 48000,
      durationMs,
      sourceDurationMs: truncated ? this.simulatedTruncatedDurationMs! : durationMs,
      truncated,
      sourceSampleRate: 48000,
      sourceChannels: 1
    };
  }

  public async hasAudioTrack(bytes: Uint8Array): Promise<boolean> {
    return sniffVideoContainer(bytes) !== null && this.videoHasSound;
  }

  public async probeAudio(bytes: Uint8Array): Promise<AudioProbeInfo> {
    const header = sniffAudioContainer(bytes);
    const decoded = await this.decodeAudio(bytes);
    return {
      format: header.format,
      duration_ms: decoded.durationMs,
      sample_rate: decoded.sourceSampleRate,
      channels: decoded.sourceChannels
    };
  }

  public async waveform(bytes: Uint8Array): Promise<PeakBuckets> {
    const decoded = await this.decodeAudio(bytes);
    return computePeaksFromFloat32(decoded.samples, LIMITS.WAVEFORM_BUCKETS);
  }

  public async renderAudio(
    bytes: Uint8Array,
    edit: { start_ms: number; end_ms: number; volume: number }
  ): Promise<PcmMono48k> {
    const decoded = await this.decodeAudio(bytes);
    return trimPcmSamples(decoded.samples, decoded.sampleRate, edit.start_ms, edit.end_ms, edit.volume);
  }

  public async encodeOpus(_pcm: PcmMono48k): Promise<Uint8Array> {
    return new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0x00, 0x02]); // "OggS" header stub
  }

  public async renderVideo(request: VideoRenderRequest): Promise<VideoRenderResult> {
    this.lastVideoRequest = request;
    const durationMs = Math.max(request.endMs - request.startMs, Math.round(request.minDurationMs ?? 0));
    const isMp4 = request.container === "mp4";
    const stub = isMp4 ? makeTinyMp4() : new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x00, 0x00, 0x00, 0x00]);
    return {
      bytes: stub,
      mimeType: isMp4 ? "video/mp4" : "video/webm",
      extension: isMp4 ? "mp4" : "webm",
      durationMs,
      hasAlpha: !isMp4
    };
  }

  public async extractAudioTrack(
    _videoBytes: Uint8Array,
    durationMs: number
  ): Promise<{ wavBytes: Uint8Array; silent: boolean }> {
    const ms = Math.max(LIMITS.MIN_AUDIO_DURATION_MS, Math.round(durationMs));
    return {
      wavBytes: makeToneWav(ms, { silenceMs: this.videoHasSound ? 0 : ms }),
      silent: !this.videoHasSound
    };
  }

  public async zip(entries: ZipEntryInput[]): Promise<Uint8Array> {
    const record: Record<string, Uint8Array> = {};
    for (const entry of entries) {
      assertSafeZipEntryPath(entry.path);
      record[entry.path] = entry.bytes;
    }
    return zipSync(record, { level: 6 });
  }

  public async unzip(zipBytes: Uint8Array): Promise<ZipEntryInput[]> {
    let raw: Record<string, Uint8Array>;
    try {
      raw = unzipSync(zipBytes);
    } catch {
      throw new StikSoundError("package-invalid", "Corrupt or unreadable ZIP archive.");
    }
    return Object.entries(raw).map(([entryPath, bytes]) => {
      assertSafeZipEntryPath(entryPath);
      return { path: entryPath, bytes };
    });
  }
}
