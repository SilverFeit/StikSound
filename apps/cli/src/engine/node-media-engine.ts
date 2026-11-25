import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
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
import { computePeaksFromFloat32, encodeWavBytes, sniffAudioContainer, sniffVideoContainer, trimPcmSamples } from "@stiksound/media-web";
import { decodeAudio, encodeOggOpus, type DecodedAudio } from "./audio";
import { resolveBinaries, type FfmpegBinaries } from "./ffmpeg";
import { probeStickerSource, probeVideoClip, renderStickerFrame } from "./image";
import { withTempDir } from "./temp";
import { renderStickerVideo } from "./video";
import { encodeWebpUnderLimit } from "./webp";

/** Probe, waveform and render all need the same decoded audio; keep the last few around. */
const DECODE_CACHE_ENTRIES = 2;

export interface CliMediaEngine extends MediaEngine {
  decodeAudio(bytes: Uint8Array): Promise<DecodedAudio>;
  hasAudioTrack(bytes: Uint8Array): Promise<boolean>;
  getBinaries(): FfmpegBinaries;
}

/**
 * Headless MediaEngine for Node (CLI and optional MCP mode).
 * Decoding and video encoding use the local FFmpeg binaries, WebP uses libwebp in WebAssembly,
 * and everything pure TypeScript (sniffing, trim, peaks, WAV, ZIP path validation) is reused
 * directly from @stiksound/core and @stiksound/media-web without modifying the GUI engines.
 */
export class NodeMediaEngine implements CliMediaEngine {
  private readonly binaries: FfmpegBinaries;
  private readonly decodeCache = new Map<string, Promise<DecodedAudio>>();

  constructor(binaries: FfmpegBinaries = resolveBinaries()) {
    this.binaries = binaries;
  }

  public getBinaries(): FfmpegBinaries {
    return this.binaries;
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

  /** Checks whether a video container has a real audio stream via ffprobe. */
  public async hasAudioTrack(bytes: Uint8Array): Promise<boolean> {
    const videoFormat = sniffVideoContainer(bytes);
    if (!videoFormat) return false;
    return withTempDir(async (dir) => {
      const file = path.join(dir, `clip.${videoFormat}`);
      await writeFile(file, bytes);
      const info = await probeVideoClip(this.binaries, file);
      return info.hasAudio;
    });
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
      assertSafeZipEntryPath(entry.path);
      record[entry.path] = entry.bytes;
    }
    return zipSync(record, { level: 6 });
  }

  public async unzip(zipBytes: Uint8Array): Promise<ZipEntryInput[]> {
    let raw: Record<string, Uint8Array>;
    try {
      let declaredBytes = 0;
      let seenEntries = 0;
      raw = unzipSync(zipBytes, {
        filter: (file) => {
          seenEntries++;
          if (seenEntries > LIMITS.MAX_PACKAGE_FILES) {
            throw new StikSoundError("package-invalid", "ZIP exceeds 32 entry limit.");
          }
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
      assertSafeZipEntryPath(entryPath);
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
