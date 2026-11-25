import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { LIMITS, StikSoundError, computeSquareCrop, createProject } from "@stiksound/core";
import { sniffAudioContainer, sniffVideoContainer } from "@stiksound/media-web";
import type { ServerContext } from "../context";
import { renderPreview } from "../export";
import { readInputFile, type InputFile } from "../files";
import { findLoudestWindow, leadingSilenceMs, peakLevel } from "../loudness";
import { guarded, jsonResult } from "../results";

const inputSchema = {
  path: z.string().describe("Absolute path (or ~/...) to an image, GIF, short video clip or audio file."),
  crop_x: z.number().min(0).max(1).optional().describe("Preview a horizontal crop anchor for an image or clip (0 to 1)."),
  crop_y: z.number().min(0).max(1).optional().describe("Preview a vertical crop anchor for an image or clip (0 to 1).")
};

async function describeAudio(context: ServerContext, file: InputFile) {
  if (file.bytes.byteLength > LIMITS.MAX_AUDIO_BYTES) {
    throw new StikSoundError("file-too-large", "Audio exceeds 25 MB limit.");
  }
  const format = sniffAudioContainer(file.bytes).format;
  const decoded = await context.engine.decodeAudio(file.bytes);
  const suggested: Record<string, { start_ms: number; end_ms: number }> = {};
  for (const preset of LIMITS.AUDIO_DURATION_PRESETS) {
    suggested[`${preset / 1000}s`] = findLoudestWindow(decoded.samples, decoded.sampleRate, preset);
  }
  return jsonResult({
    kind: "audio",
    path: file.path,
    format,
    duration_ms: decoded.durationMs,
    sample_rate: decoded.sourceSampleRate,
    channels: decoded.sourceChannels,
    within_import_limit: decoded.durationMs <= LIMITS.MAX_AUDIO_DURATION_MS,
    peak_level: Number(peakLevel(decoded.samples).toFixed(3)),
    leading_silence_ms: leadingSilenceMs(decoded.samples, decoded.sampleRate),
    loudest_window: suggested
  });
}

export function registerProbeMedia(server: McpServer, context: ServerContext): void {
  server.registerTool(
    "probe_media",
    {
      title: "Inspect a media file",
      description:
        "Reads a local image, GIF, clip or audio file and reports what StikSound would do with it, without writing anything. " +
        "Images and clips: format, size, transparency, animation, the square output size and a preview of the crop. " +
        "Audio: duration, level, leading silence and the loudest 5 s and 10 s windows, to choose start_ms and end_ms for create_sound_sticker.",
      inputSchema,
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    (args) =>
      guarded(async () => {
        const { controller } = context;
        const file = await readInputFile(args.path, LIMITS.MAX_VIDEO_BYTES, "path");

        let state;
        try {
          state = await controller.importSticker(createProject(), file.bytes, file.name);
        } catch (err) {
          // Not a picture. An .m4a shares the MP4 container, so a file with no video track lands here too.
          const notVisual =
            err instanceof StikSoundError && (err.code === "unsupported-image" || err.code === "unsupported-video");
          if (!notVisual) throw err;
          return describeAudio(context, file);
        }

        if (args.crop_x !== undefined || args.crop_y !== undefined) {
          state = controller.updateStickerEdit(state, {
            ...(args.crop_x !== undefined ? { crop_x: args.crop_x } : {}),
            ...(args.crop_y !== undefined ? { crop_y: args.crop_y } : {})
          });
        }
        const sticker = state.manifest.stickers[0]!;
        const isClip = sniffVideoContainer(file.bytes) !== null;
        const side = computeSquareCrop(sticker.width, sticker.height).outputSize;
        const ownSound = state.manifest.audios[0];

        return jsonResult(
          {
            kind: isClip ? "video" : "image",
            path: file.path,
            format: sticker.format,
            width: sticker.width,
            height: sticker.height,
            has_alpha: sticker.has_alpha,
            animated: sticker.animated,
            ...(sticker.duration_ms ? { duration_ms: sticker.duration_ms } : {}),
            ...(isClip ? { has_sound: ownSound !== undefined && ownSound.source_name !== "Video sin sonido" } : {}),
            output_px: `${side}x${side}`,
            needs_crop: sticker.width !== sticker.height,
            static_webp_supported: !sticker.animated
          },
          await renderPreview(context, state)
        );
      })
  );
}
