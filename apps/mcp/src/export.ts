import {
  LIMITS,
  computeSquareCrop,
  type ExportArtifact,
  type ExportProfileId,
  type ProjectWorkspaceState
} from "@stiksound/core";
import { encodeWebpAtQuality } from "@stiksound/media-node";
import type { ServerContext } from "./context";
import { publishFile, resolveUserPath } from "./files";
import type { PreviewImage } from "./results";

export const ENABLED_PROFILES = ["video-mp4", "video-webm-alpha", "sound-bundle", "standard-webp"] as const;
export type EnabledProfile = (typeof ENABLED_PROFILES)[number];

/**
 * What the exported file is and is not. The apps show the same caveat after an export: no profile
 * produces a WhatsApp sticker with sound, and the agent must not tell the user that it did.
 */
const PROFILE_NOTES: Record<EnabledProfile, string> = {
  "video-mp4":
    "This MP4 is a video, not a WhatsApp sticker: sending or pasting it in a chat sends a video and does not add it to the sticker tray. Some Android beta accounts can pick it from the gallery under Create sticker; WhatsApp then decides the duration and the audio, and that beta is not officially documented.",
  "video-webm-alpha":
    "This WebM keeps transparency and is a video, not a WhatsApp sticker. WhatsApp does not add it to the sticker tray.",
  "sound-bundle":
    "The ZIP holds sticker.webp and sound.ogg as two separate files plus a manifest. WhatsApp treats the WebP as a normal sticker without sound.",
  "standard-webp": "A static 512 px WebP sticker without audio."
};

export function durationPresetMs(maxDurationSeconds: 5 | 10 | undefined): number {
  return (maxDurationSeconds ?? LIMITS.DEFAULT_VIDEO_MAX_AUDIO_MS / 1000) * 1000;
}

/** A small WebP of the sticker's first frame with its crop applied, for the model to check the framing. */
export async function renderPreview(context: ServerContext, state: ProjectWorkspaceState): Promise<PreviewImage | null> {
  const sticker = state.manifest.stickers[0];
  const bytes = sticker ? state.assets.get(sticker.file) : undefined;
  if (!sticker || !bytes) return null;
  try {
    const frame = await context.engine.renderSticker(bytes, sticker.edit);
    return { bytes: await encodeWebpAtQuality(frame, 75), mimeType: "image/webp" };
  } catch {
    // The preview is a convenience; a failure here must not fail an export that succeeded.
    return null;
  }
}

export interface PublishedExport {
  payload: Record<string, unknown>;
  outputPath: string;
}

/** Writes an export to disk and builds the description of it that every exporting tool returns. */
export async function publishArtifact(
  context: ServerContext,
  state: ProjectWorkspaceState,
  artifact: ExportArtifact,
  options: { outputDir?: string; copyToClipboard?: boolean }
): Promise<PublishedExport> {
  const dir = options.outputDir ? resolveUserPath(options.outputDir, "output_dir") : context.outputDir;
  const outputPath = await publishFile(dir, artifact.fileName, artifact.bytes);

  const sticker = state.manifest.stickers[0]!;
  const audio = state.manifest.audios[0];
  const trim = state.manifest.associations[0];
  const usesAudio = artifact.profile !== "standard-webp";
  const side = computeSquareCrop(sticker.width, sticker.height).outputSize;

  const payload: Record<string, unknown> = {
    output_path: outputPath,
    profile: artifact.profile,
    mime_type: artifact.mimeType,
    size_bytes: artifact.bytes.byteLength,
    ...(artifact.durationMs !== undefined ? { duration_ms: artifact.durationMs } : {}),
    output_px: `${side}x${side}`,
    sticker: {
      source_name: sticker.source_name,
      format: sticker.format,
      width: sticker.width,
      height: sticker.height,
      animated: sticker.animated,
      has_alpha: sticker.has_alpha,
      crop_x: sticker.edit.crop_x ?? 0.5,
      crop_y: sticker.edit.crop_y ?? 0.5
    },
    ...(usesAudio && audio && trim
      ? {
          audio: {
            source: audio.source.type,
            source_name: audio.source_name,
            ...(audio.source.page_url ? { page_url: audio.source.page_url } : {}),
            duration_ms: audio.duration_ms,
            trim: { start_ms: trim.start_ms, end_ms: trim.end_ms },
            volume: trim.volume
          }
        }
      : {})
  };

  if (options.copyToClipboard) {
    payload.copied_to_clipboard = await context.copyToClipboard(outputPath);
  }
  payload.note = PROFILE_NOTES[artifact.profile as EnabledProfile];
  return { payload, outputPath };
}

export function isEnabledProfile(profile: ExportProfileId): profile is EnabledProfile {
  return (ENABLED_PROFILES as readonly string[]).includes(profile);
}
