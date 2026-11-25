import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { StikSoundError } from "@stiksound/core";
import { ToolInputError } from "./errors";

export interface PreviewImage {
  bytes: Uint8Array;
  mimeType: "image/webp";
}

/** A successful call: the facts as JSON text, plus an optional picture the model can look at. */
export function jsonResult(payload: Record<string, unknown>, preview?: PreviewImage | null): CallToolResult {
  const content: CallToolResult["content"] = [{ type: "text", text: JSON.stringify(payload, null, 2) }];
  if (preview) {
    content.push({
      type: "image",
      data: Buffer.from(preview.bytes).toString("base64"),
      mimeType: preview.mimeType
    });
  }
  return { content };
}

/**
 * A failed call, reported as a tool error with the same structured codes the apps use
 * (`trim-out-of-range`, `url-rejected`, ...) so the agent can correct its input and retry.
 */
export function errorResult(err: unknown): CallToolResult {
  let code = "internal-error";
  let message = err instanceof Error ? err.message : String(err);
  if (err instanceof StikSoundError) {
    code = err.code;
    message = err.detail ?? err.getLocalized("en").action;
  } else if (err instanceof ToolInputError) {
    code = err.code;
  }
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ error: { code, message } }, null, 2) }]
  };
}

/** Runs a tool body and converts anything it throws into an error result. */
export async function guarded(body: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await body();
  } catch (err) {
    return errorResult(err);
  }
}
