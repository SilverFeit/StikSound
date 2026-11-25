import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  StikSoundError,
  computeSquareCrop,
  type ImageProbeInfo,
  type RgbaFrame512,
  type StickerEdit,
  type VideoFormat
} from "@stiksound/core";
import { sniffImageHeader, sniffVideoContainer } from "@stiksound/media-web";
import { ProcessFailedError, runBinary, type FfmpegBinaries } from "./ffmpeg";
import { probeFile } from "./probe";
import { withTempDir } from "./temp";

/** Frame rate assumed for a video sticker's frame count, the same value the web engine reports. */
const CLIP_PROBE_FPS = 15;

export interface VideoClipInfo {
  width: number;
  height: number;
  durationMs: number;
}

/** Display size (after rotation metadata) and duration of a video clip on disk. */
export async function probeVideoClip(binaries: FfmpegBinaries, filePath: string): Promise<VideoClipInfo> {
  let probed;
  try {
    probed = await probeFile(binaries, filePath);
  } catch (err) {
    if (err instanceof StikSoundError) throw err;
    throw new StikSoundError("unsupported-video", "FFmpeg could not read the video file.");
  }
  const video = probed.streams.find((stream) => stream.codecType === "video");
  if (!video || video.width <= 0 || video.height <= 0) {
    throw new StikSoundError("unsupported-video", "The file has no readable video track.");
  }
  const sideways = video.rotation === 90 || video.rotation === 270;
  return {
    width: sideways ? video.height : video.width,
    height: sideways ? video.width : video.height,
    durationMs: probed.durationMs || video.durationMs
  };
}

/** Sticker facts: header sniffing for images, ffprobe for video clips. */
export async function probeStickerSource(binaries: FfmpegBinaries, bytes: Uint8Array): Promise<ImageProbeInfo> {
  const videoFormat = sniffVideoContainer(bytes);
  if (!videoFormat) {
    return sniffImageHeader(bytes);
  }
  const clip = await withTempDir(async (dir) => {
    const file = path.join(dir, `clip.${videoFormat}`);
    await writeFile(file, bytes);
    return probeVideoClip(binaries, file);
  });
  if (clip.durationMs <= 0) {
    throw new StikSoundError("unsupported-video", "The video has no readable duration.");
  }
  return {
    format: videoFormat,
    width: clip.width,
    height: clip.height,
    has_alpha: false,
    animated: true,
    frame_count: Math.max(1, Math.round((clip.durationMs / 1000) * CLIP_PROBE_FPS)),
    duration_ms: clip.durationMs
  };
}

/** The ffmpeg filter that applies the project's 1:1 crop and scales to the sticker size. */
export function squareCropFilter(width: number, height: number, cropX: number, cropY: number): {
  filter: string;
  outputSize: number;
} {
  const crop = computeSquareCrop(width, height, cropX, cropY);
  return {
    filter: `crop=${crop.cropSide}:${crop.cropSide}:${crop.srcX}:${crop.srcY},scale=${crop.outputSize}:${crop.outputSize}:flags=lanczos`,
    outputSize: crop.outputSize
  };
}

/**
 * Decodes the first frame of an image or clip, cropped 1:1 at the edit's anchor and scaled to at
 * most 512 px, as straight (non-premultiplied) RGBA.
 */
export async function renderStickerFrame(
  binaries: FfmpegBinaries,
  bytes: Uint8Array,
  edit: Pick<StickerEdit, "crop_x" | "crop_y">
): Promise<RgbaFrame512> {
  const videoFormat: VideoFormat | null = sniffVideoContainer(bytes);
  const imageInfo = videoFormat ? null : sniffImageHeader(bytes);

  return withTempDir(async (dir) => {
    const file = path.join(dir, `sticker.${videoFormat ?? imageInfo!.format}`);
    await writeFile(file, bytes);

    const size = videoFormat ? await probeVideoClip(binaries, file) : imageInfo!;
    const { filter, outputSize } = squareCropFilter(size.width, size.height, edit.crop_x ?? 0.5, edit.crop_y ?? 0.5);

    // Image headers report stored pixels, so EXIF rotation must not be applied on top of them.
    const inputFlags = videoFormat ? [] : ["-noautorotate"];
    let stdout: Uint8Array;
    try {
      const result = await runBinary(
        binaries.ffmpeg,
        ["-v", "error", ...inputFlags, "-i", file, "-vf", filter, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"],
        { timeoutMs: 60_000, maxOutputBytes: 8 * 1024 * 1024 }
      );
      stdout = result.stdout;
    } catch (err) {
      if (err instanceof ProcessFailedError) {
        throw new StikSoundError(
          videoFormat ? "unsupported-video" : "unsupported-image",
          "FFmpeg could not decode the sticker source."
        );
      }
      throw err;
    }

    if (stdout.byteLength !== outputSize * outputSize * 4) {
      throw new StikSoundError("encode-failed", "Decoded sticker frame has an unexpected size.");
    }
    return { width: outputSize, height: outputSize, data: stdout };
  });
}
