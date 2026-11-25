import { writeFile } from "node:fs/promises";
import path from "node:path";
import { LIMITS, StikSoundError, type PcmMono48k } from "@stiksound/core";
import {
  ProcessFailedError,
  detectCapabilities,
  pickOpusEncoder,
  runBinary,
  type FfmpegBinaries
} from "./ffmpeg";
import { probeFile } from "./probe";
import { withTempDir } from "./temp";

const PCM_RATE = LIMITS.OPUS_SAMPLE_RATE;
/** Decode a little past the 3 minute import limit so an over-long file is still measured as too long. */
const DECODE_CAP_SECONDS = LIMITS.MAX_AUDIO_DURATION_MS / 1000 + 20;
const DECODE_CAP_MS = DECODE_CAP_SECONDS * 1000;

export interface DecodedAudio {
  /** Mono samples at 48 kHz (capped at DECODE_CAP_SECONDS). */
  samples: Float32Array;
  sampleRate: 48000;
  /** Duration of the decoded PCM samples in milliseconds. */
  durationMs: number;
  /** True container/stream duration reported by ffprobe when longer than the decoded cap. */
  sourceDurationMs: number;
  /** Whether decoding stopped at DECODE_CAP_SECONDS because the source is longer. */
  truncated: boolean;
  /** Sample rate and channel count of the source track, before the downmix. */
  sourceSampleRate: number;
  sourceChannels: number;
}

/**
 * Decodes the first audio track of any container ffmpeg reads to mono 48 kHz float PCM. The
 * duration comes from the decoded sample count (accurate for VBR files), while `sourceDurationMs`
 * preserves the full container duration if the track exceeds the decode cap.
 */
export async function decodeAudio(binaries: FfmpegBinaries, bytes: Uint8Array): Promise<DecodedAudio> {
  return withTempDir(async (dir) => {
    const file = path.join(dir, "audio-input");
    await writeFile(file, bytes);

    let stdout: Uint8Array;
    let sourceSampleRate: number = PCM_RATE;
    let sourceChannels = 1;
    let probedDurationMs = 0;
    try {
      const probed = await probeFile(binaries, file);
      const track = probed.streams.find((stream) => stream.codecType === "audio");
      if (!track) {
        throw new StikSoundError("unsupported-audio", "The file has no audio track.");
      }
      sourceSampleRate = track.sampleRate || PCM_RATE;
      sourceChannels = track.channels || 1;
      probedDurationMs = track.durationMs || probed.durationMs || 0;

      const result = await runBinary(binaries.ffmpeg, [
        "-v", "error",
        "-i", file,
        "-vn",
        "-map", "0:a:0",
        "-t", String(DECODE_CAP_SECONDS),
        "-ac", "1",
        "-ar", String(PCM_RATE),
        "-f", "f32le",
        "pipe:1"
      ]);
      stdout = result.stdout;
    } catch (err) {
      if (err instanceof ProcessFailedError) {
        throw new StikSoundError("unsupported-audio", "FFmpeg could not decode the audio.");
      }
      throw err;
    }

    const sampleCount = Math.floor(stdout.byteLength / 4);
    const samples = new Float32Array(stdout.buffer, stdout.byteOffset, sampleCount);
    const decodedDurationMs = Math.round((sampleCount / PCM_RATE) * 1000);
    const truncated = probedDurationMs > DECODE_CAP_MS + 500 || decodedDurationMs >= DECODE_CAP_MS - 50;
    const sourceDurationMs = truncated && probedDurationMs > decodedDurationMs ? probedDurationMs : decodedDurationMs;

    return {
      samples,
      sampleRate: 48000,
      durationMs: decodedDurationMs,
      sourceDurationMs,
      truncated,
      sourceSampleRate,
      sourceChannels
    };
  });
}

/** Appends silence so the clip is at least `targetDurationMs` long. */
export function padPcmToDuration(pcm: PcmMono48k, targetDurationMs: number): PcmMono48k {
  const targetSamples = Math.round((targetDurationMs / 1000) * PCM_RATE);
  if (pcm.samples.length >= targetSamples) {
    return pcm;
  }
  const padded = new Float32Array(targetSamples);
  padded.set(pcm.samples);
  return { sampleRate: 48000, channels: 1, samples: padded, durationMs: targetDurationMs };
}

/** Encodes mono 48 kHz PCM as Ogg Opus at the bundle bitrate (64 kbps). */
export async function encodeOggOpus(binaries: FfmpegBinaries, pcm: PcmMono48k): Promise<Uint8Array> {
  const capabilities = await detectCapabilities(binaries.ffmpeg);
  const encoder = pickOpusEncoder(capabilities.encoders);
  if (!encoder) {
    throw new StikSoundError("unsupported-codec", "This FFmpeg build has no Opus encoder.");
  }
  // FFmpeg's built-in Opus encoder is still flagged experimental.
  const experimental = encoder === "opus" ? ["-strict", "-2"] : [];
  const stdin = new Uint8Array(pcm.samples.buffer, pcm.samples.byteOffset, pcm.samples.byteLength);
  try {
    const result = await runBinary(
      binaries.ffmpeg,
      [
        "-v", "error",
        "-f", "f32le", "-ar", String(PCM_RATE), "-ac", "1", "-i", "pipe:0",
        "-c:a", encoder, ...experimental,
        "-b:a", String(LIMITS.OPUS_BITRATE_BPS),
        "-f", "ogg",
        "pipe:1"
      ],
      { stdin }
    );
    return result.stdout;
  } catch (err) {
    if (err instanceof ProcessFailedError) {
      throw new StikSoundError("encode-failed", "FFmpeg could not encode Opus audio.");
    }
    throw err;
  }
}
