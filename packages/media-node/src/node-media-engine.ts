import { createHash } from "node:crypto";
import { unzipSync, zipSync } from "fflate";
import {
  LIMITS,
  StikSoundError,
  assertSafeZipEntryPath,
  type AudioProbeInfo,
  type ImageProbeInfo,
  type MediaEngine,
  type PcmMono48k,
  type PeakBuckets,
  type RgbaFrame512,
  type StickerEdit,
  type VideoRenderRequest,
  type VideoRenderResult,
  type ZipEntryInput
} from "@stiksound/core";
import { computePeaksFromFloat32, encodeWavBytes, sniffAudioContainer, trimPcmSamples } from "@stiksound/media-web";
import { decodeAudio, encodeOggOpus, type DecodedAudio } from "./audio";
import { resolveBinaries, type FfmpegBinaries } from "./ffmpeg";
import { probeStickerSource, renderStickerFrame } from "./image";
import { renderStickerVideo } from "./video";
import { encodeWebpUnderLimit } from "./webp";

/** The two media files of a sound bundle, which sit next to manifest.json instead of under assets/. */
const BUNDLE_ENTRY_PATHS: ReadonlySet<string> = new Set(["sticker.webp", "sound.ogg"]);

/** Entry names a project package or a sound bundle may contain. Anything else is rejected. */
function assertPackageEntryPath(entryPath: string): void {
  if (!BUNDLE_ENTRY_PATHS.has(entryPath)) {
    assertSafeZipEntryPath(entryPath);
  }
}

/** Probe, waveform and render all need the same decoded audio; keep the last few around. */
const DECODE_CACHE_ENTRIES = 2;

/**
 * MediaEngine for Node. Decoding and video encoding go through the local FFmpeg binaries, WebP
 * through a WebAssembly encoder, and everything else reuses the pure TypeScript helpers the web
 * engine already has (sniffers, trim, waveform peaks).
 */
export class NodeMediaEngine implements MediaEngine {
  private readonly binaries: FfmpegBinaries;
  private readonly decodeCache = new Map<string, Promise<DecodedAudio>>();

  constructor(binaries: FfmpegBinaries = resolveBinaries()) {
    this.binaries = binaries;
  }

  public probeImage(bytes: Uint8Array): Promise<ImageProbeInfo> {
    return probeStickerSource(this.binaries, bytes);
  }

  public renderSticker(bytes: Uint8Array, edit: StickerEdit): Promise<RgbaFrame512> {
    return renderStickerFrame(this.binaries, bytes, edit);
  }

  public encodeWebp(frame: RgbaFrame512): Promise<Uint8Array> {
    return encodeWebpUnderLimit(frame);
  }

  /** Decoded mono 48 kHz samples of an audio file or of a video's sound track. */
  public decodeAudio(bytes: Uint8Array): Promise<DecodedAudio> {
    const key = createHash("sha1").update(bytes).digest("hex");
    const cached = this.decodeCache.get(key);
    if (cached) {
      return cached;
    }
    const pending = decodeAudio(this.binaries, bytes);
    this.decodeCache.set(key, pending);
    pending.catch(() => this.decodeCache.delete(key));
    while (this.decodeCache.size > DECODE_CACHE_ENTRIES) {
      this.decodeCache.delete(this.decodeCache.keys().next().value!);
    }
    return pending;
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

  public encodeOpus(pcm: PcmMono48k): Promise<Uint8Array> {
    return encodeOggOpus(this.binaries, pcm);
  }

  public async renderVideo(request: VideoRenderRequest): Promise<VideoRenderResult> {
    const audio = await this.renderAudio(request.audioBytes, {
      start_ms: request.startMs,
      end_ms: request.endMs,
      volume: request.volume
    });
    return renderStickerVideo(this.binaries, request, audio);
  }

  /** Video stickers: the clip's sound as mono WAV, or silence of the clip's length. */
  public async extractAudioTrack(
    videoBytes: Uint8Array,
    durationMs: number
  ): Promise<{ wavBytes: Uint8Array; silent: boolean }> {
    try {
      const decoded = await decodeAudio(this.binaries, videoBytes);
      if (decoded.durationMs >= LIMITS.MIN_AUDIO_DURATION_MS) {
        const pcm: PcmMono48k = {
          sampleRate: 48000,
          channels: 1,
          samples: decoded.samples,
          durationMs: decoded.durationMs
        };
        return { wavBytes: encodeWavBytes(pcm), silent: false };
      }
    } catch (err) {
      // A clip without a sound track is normal; a missing FFmpeg is not.
      if (!(err instanceof StikSoundError) || err.code !== "unsupported-audio") {
        throw err;
      }
    }
    const ms = Math.max(LIMITS.MIN_AUDIO_DURATION_MS, Math.round(durationMs));
    const silence: PcmMono48k = {
      sampleRate: 48000,
      channels: 1,
      samples: new Float32Array(Math.round(ms * 48)),
      durationMs: ms
    };
    return { wavBytes: encodeWavBytes(silence), silent: true };
  }

  public async zip(entries: ZipEntryInput[]): Promise<Uint8Array> {
    if (entries.length > LIMITS.MAX_PACKAGE_FILES) {
      throw new StikSoundError("package-invalid", "Too many zip entries.");
    }
    const record: Record<string, Uint8Array> = {};
    for (const entry of entries) {
      assertPackageEntryPath(entry.path);
      record[entry.path] = entry.bytes;
    }
    return zipSync(record, { level: 6 });
  }

  public async unzip(zipBytes: Uint8Array): Promise<ZipEntryInput[]> {
    let raw: Record<string, Uint8Array>;
    try {
      // Stop inflating as soon as the declared sizes pass the package limit.
      let declaredBytes = 0;
      raw = unzipSync(zipBytes, {
        filter: (file) => {
          declaredBytes += file.originalSize;
          if (declaredBytes > LIMITS.MAX_PACKAGE_BYTES) {
            throw new StikSoundError("package-invalid", "ZIP exceeds 100 MB uncompressed limit.");
          }
          return true;
        }
      });
    } catch (err) {
      if (err instanceof StikSoundError) throw err;
      throw new StikSoundError("package-invalid", "Corrupt or unreadable ZIP archive.");
    }

    const paths = Object.keys(raw);
    if (paths.length > LIMITS.MAX_PACKAGE_FILES) {
      throw new StikSoundError("package-invalid", "ZIP exceeds 32 entry limit.");
    }

    let totalBytes = 0;
    const out: ZipEntryInput[] = [];
    for (const entryPath of paths) {
      assertPackageEntryPath(entryPath);
      const bytes = raw[entryPath]!;
      totalBytes += bytes.byteLength;
      if (totalBytes > LIMITS.MAX_PACKAGE_BYTES) {
        throw new StikSoundError("package-invalid", "ZIP exceeds 100 MB uncompressed limit.");
      }
      out.push({ path: entryPath, bytes });
    }
    return out;
  }
}
