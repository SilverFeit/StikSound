import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { LIMITS } from "@stiksound/core";
import type { ServerContext } from "../context";
import { ToolInputError } from "../errors";
import { ENABLED_PROFILES, durationPresetMs, isEnabledProfile, publishArtifact, renderPreview } from "../export";
import { readInputFile, resolveUserPath } from "../files";
import { guarded, jsonResult } from "../results";

const inputSchema = {
  project_path: z.string().describe("Absolute path (or ~/...) to a .stiksound.zip project saved by StikSound or by create_sound_sticker."),
  profile: z.enum(ENABLED_PROFILES).optional().describe("Export profile. Default: the one stored in the project."),
  max_duration_s: z
    .union([z.literal(5), z.literal(10)])
    .optional()
    .describe("Maximum fragment length used to validate the stored trim. Default 10."),
  output_dir: z.string().optional().describe("Absolute folder for the result. Default ~/Downloads/StikSound."),
  copy_to_clipboard: z.boolean().optional().describe("Copy the exported file to the clipboard (macOS and Windows).")
};

export function registerExportProject(server: McpServer, context: ServerContext): void {
  server.registerTool(
    "export_project",
    {
      title: "Export a saved project",
      description:
        "Opens a .stiksound.zip project, validates it, and exports it again with its stored crop and trim, optionally with another profile. " +
        "Use it to get a second format of a sticker without repeating its settings.",
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    (args) =>
      guarded(async () => {
        const { controller } = context;
        if (args.output_dir) resolveUserPath(args.output_dir, "output_dir");

        const file = await readInputFile(args.project_path, LIMITS.MAX_PACKAGE_BYTES, "project_path");
        const state = await controller.openProject(file.bytes);
        const profile = args.profile ?? state.manifest.export.profile;
        if (!isEnabledProfile(profile)) {
          throw new ToolInputError(`The project's profile ${profile} is disabled; pass one of: ${ENABLED_PROFILES.join(", ")}.`);
        }

        const artifact = await controller.exportProject(state, profile, durationPresetMs(args.max_duration_s));
        const published = await publishArtifact(context, state, artifact, {
          outputDir: args.output_dir,
          copyToClipboard: args.copy_to_clipboard
        });
        return jsonResult(published.payload, await renderPreview(context, state));
      })
  );
}
