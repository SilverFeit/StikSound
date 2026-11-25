import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { EXPORT_PROFILES, LIMITS, createProject, sanitizeExportName } from "@stiksound/core";
import type { ServerContext } from "../context";
import { ToolInputError } from "../errors";
import { ENABLED_PROFILES, durationPresetMs, publishArtifact, renderPreview } from "../export";
import { publishFile, readInputFile, resolveUserPath } from "../files";
import { findLoudestWindow } from "../loudness";
import { guarded, jsonResult } from "../results";

const inputSchema = {
  image_path: z
    .string()
    .describe("Absolute path (or ~/...) to the sticker source: PNG, JPG, WebP, GIF (animated GIFs loop), or a short MP4/MOV/WebM clip."),
  audio_path: z
    .string()
    .optional()
    .describe("Absolute path to a local MP3, WAV, OGG, M4A or AAC file (max 25 MB, 3 minutes). Omit for a video clip to use the clip's own sound."),
  myinstants_url: z
    .string()
    .optional()
    .describe("A myinstants.com instant page or direct /media/sounds/ URL to download the sound from. Use instead of audio_path."),
  start_ms: z.number().int().min(0).optional().describe("Start of the audio fragment in milliseconds. Default 0."),
  end_ms: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("End of the audio fragment in milliseconds. Default: start_ms plus the maximum duration, capped at the audio length."),
  trim: z
    .enum(["start", "loudest"])
    .optional()
    .describe('Used only when start_ms and end_ms are omitted. "start" (default) takes the first seconds; "loudest" takes the window with the most energy.'),
  max_duration_s: z
    .union([z.literal(5), z.literal(10)])
    .optional()
    .describe("Maximum fragment length, the app's 5s | 10s switch. Default 10."),
  volume: z.number().min(0).max(1).optional().describe("Audio gain from 0 to 1. Default 1."),
  crop_x: z.number().min(0).max(1).optional().describe("Horizontal anchor of the 1:1 crop for a wide image: 0 left, 0.5 center, 1 right."),
  crop_y: z.number().min(0).max(1).optional().describe("Vertical anchor of the 1:1 crop for a tall image: 0 top, 0.5 center, 1 bottom."),
  background_color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional()
    .describe("#RRGGBB color behind transparent areas in MP4, which has no alpha. Default #FFFFFF."),
  profile: z
    .enum(ENABLED_PROFILES)
    .optional()
    .describe("video-mp4 (default, H.264 + AAC), video-webm-alpha (keeps transparency), sound-bundle (ZIP with sticker.webp + sound.ogg) or standard-webp (static sticker, no audio)."),
  name: z.string().max(80).optional().describe("Project name; the output file name derives from it. Default: the image file name."),
  output_dir: z.string().optional().describe("Absolute folder for the result. Default ~/Downloads/StikSound. Existing files are never overwritten."),
  save_project: z
    .boolean()
    .optional()
    .describe("Also save an editable .stiksound.zip project that the StikSound apps can reopen."),
  copy_to_clipboard: z.boolean().optional().describe("Copy the exported file to the clipboard (macOS and Windows).")
};

export function registerCreateSoundSticker(server: McpServer, context: ServerContext): void {
  server.registerTool(
    "create_sound_sticker",
    {
      title: "Create a sound sticker",
      description:
        "Combines an image, GIF or short clip with an audio fragment of up to 5 or 10 seconds and writes the result to disk, processed locally with FFmpeg. " +
        "The image is cropped to a square and never upscaled (max 512 px). Returns the output path, the applied trim and a preview of the framing. " +
        "The result is a file to share, not an installed WhatsApp sticker; relay the returned note to the user.",
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    (args) =>
      guarded(async () => {
        const { controller, engine } = context;
        const profile = args.profile ?? "video-mp4";
        const maxMs = durationPresetMs(args.max_duration_s);
        if (args.audio_path && args.myinstants_url) {
          throw new ToolInputError("Pass either audio_path or myinstants_url, not both.");
        }
        // Validate the destination before doing any work.
        if (args.output_dir) resolveUserPath(args.output_dir, "output_dir");

        const image = await readInputFile(args.image_path, LIMITS.MAX_VIDEO_BYTES, "image_path");
        const projectName = args.name?.trim() || path.parse(image.name).name;
        let state = createProject(projectName, profile);
        state = await controller.importSticker(state, image.bytes, image.name, maxMs);

        if (args.audio_path) {
          const audio = await readInputFile(args.audio_path, LIMITS.MAX_AUDIO_BYTES, "audio_path");
          state = await controller.importAudioFile(state, audio.bytes, audio.name, { type: "local" }, maxMs);
        } else if (args.myinstants_url) {
          state = await controller.importAudioUrl(state, args.myinstants_url, maxMs);
        }

        const audio = state.manifest.audios[0];
        if (EXPORT_PROFILES[profile].requiresAudio && !audio) {
          throw new ToolInputError(`Profile ${profile} needs a sound: pass audio_path or myinstants_url.`);
        }

        if (args.crop_x !== undefined || args.crop_y !== undefined || args.background_color !== undefined) {
          state = controller.updateStickerEdit(state, {
            ...(args.crop_x !== undefined ? { crop_x: args.crop_x } : {}),
            ...(args.crop_y !== undefined ? { crop_y: args.crop_y } : {}),
            ...(args.background_color !== undefined ? { matte_color: args.background_color.toUpperCase() } : {})
          });
        }

        if (audio) {
          let window: { start_ms: number; end_ms: number } | null = null;
          if (args.start_ms !== undefined || args.end_ms !== undefined) {
            const start = args.start_ms ?? 0;
            window = { start_ms: start, end_ms: args.end_ms ?? Math.min(audio.duration_ms, start + maxMs) };
          } else if (args.trim === "loudest" && audio.duration_ms > maxMs) {
            const decoded = await engine.decodeAudio(state.assets.get(audio.file)!);
            window = findLoudestWindow(decoded.samples, decoded.sampleRate, maxMs);
          }
          if (window || args.volume !== undefined) {
            state = controller.updateAudioEdit(
              state,
              { ...(window ?? {}), ...(args.volume !== undefined ? { volume: args.volume } : {}) },
              maxMs
            );
          }
        }

        const artifact = await controller.exportProject(state, profile, maxMs);
        const published = await publishArtifact(context, state, artifact, {
          outputDir: args.output_dir,
          copyToClipboard: args.copy_to_clipboard
        });

        if (args.save_project) {
          const projectBytes = await controller.saveProject(state);
          published.payload.project_path = await publishFile(
            path.dirname(published.outputPath),
            `${sanitizeExportName(state.manifest.project.name)}.stiksound.zip`,
            projectBytes
          );
        }

        return jsonResult(published.payload, await renderPreview(context, state));
      })
  );
}
