import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { StikSoundError } from "@stiksound/core";
import { CliInputError } from "../errors";
import type { PreviewImage } from "../service";

/** A successful MCP tool call: structured JSON text plus an optional WebP preview image. */
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

/** A failed MCP tool call with structured domain error codes so the agent can retry cleanly. */
export function errorResult(err: unknown): CallToolResult {
  let code = "internal-error";
  let message = err instanceof Error ? err.message : String(err);
  if (err instanceof StikSoundError) {
    code = err.code;
    message = err.detail ?? err.getLocalized("en").action;
  } else if (err instanceof CliInputError) {
    code = err.code;
  }
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ error: { code, message } }, null, 2) }]
  };
}

/** Runs a tool handler and converts any thrown error into a structured MCP tool error. */
export async function guarded(body: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await body();
  } catch (err) {
    return errorResult(err);
  }
}
