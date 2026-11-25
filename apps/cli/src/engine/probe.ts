import { runBinary, type FfmpegBinaries } from "./ffmpeg";

export interface ProbedStream {
  codecType: "video" | "audio" | "other";
  codecName: string;
  width: number;
  height: number;
  /** Clockwise display rotation in degrees, normalized to 0, 90, 180 or 270. */
  rotation: number;
  sampleRate: number;
  channels: number;
  durationMs: number;
}

export interface ProbedFile {
  durationMs: number;
  streams: ProbedStream[];
}

interface RawStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  sample_rate?: string;
  channels?: number;
  duration?: string;
  tags?: { rotate?: string };
  side_data_list?: Array<{ rotation?: number | string }>;
}

function secondsToMs(value: string | undefined): number {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : 0;
}

function normalizeRotation(stream: RawStream): number {
  const sideData = stream.side_data_list?.find((entry) => entry.rotation !== undefined)?.rotation;
  const raw = Number(sideData ?? stream.tags?.rotate ?? 0);
  if (!Number.isFinite(raw)) return 0;
  return (((Math.round(raw / 90) * 90) % 360) + 360) % 360;
}

/** Parses the JSON printed by `ffprobe -show_format -show_streams -of json`. */
export function parseProbeJson(json: string): ProbedFile {
  const parsed = JSON.parse(json) as { format?: { duration?: string }; streams?: RawStream[] };
  const streams = (parsed.streams ?? []).map((stream): ProbedStream => ({
    codecType: stream.codec_type === "video" || stream.codec_type === "audio" ? stream.codec_type : "other",
    codecName: stream.codec_name ?? "",
    width: stream.width ?? 0,
    height: stream.height ?? 0,
    rotation: normalizeRotation(stream),
    sampleRate: Number(stream.sample_rate) || 0,
    channels: stream.channels ?? 0,
    durationMs: secondsToMs(stream.duration)
  }));
  return { durationMs: secondsToMs(parsed.format?.duration), streams };
}

/** Container and stream facts of a media file on disk. */
export async function probeFile(binaries: FfmpegBinaries, filePath: string): Promise<ProbedFile> {
  const result = await runBinary(
    binaries.ffprobe,
    ["-v", "error", "-show_format", "-show_streams", "-of", "json", filePath],
    { timeoutMs: 30_000, maxOutputBytes: 4 * 1024 * 1024 }
  );
  return parseProbeJson(new TextDecoder().decode(result.stdout));
}
