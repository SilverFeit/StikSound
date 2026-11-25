import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import packageJson from "../package.json";
import { createContext, type ServerOptions } from "./context";
import { registerCreateSoundSticker } from "./tools/create-sound-sticker";
import { registerExportProject } from "./tools/export-project";
import { registerProbeMedia } from "./tools/probe-media";

const INSTRUCTIONS = [
  "StikSound turns an image, GIF or short clip plus a sound into a square video or sticker file, entirely on this machine.",
  "Typical flow: call probe_media on the image to check the crop and on the audio to find the loudest window, then call create_sound_sticker.",
  "All paths must be absolute or start with ~/. The server cannot see files attached to the chat, only files on disk.",
  "Sounds can come from a local file or a myinstants.com URL; no other host is contacted.",
  "No output is a WhatsApp sticker with sound: WhatsApp has no public format for one. Always relay the note returned with an export."
].join(" ");

/** Builds the MCP server with its three tools. The caller connects it to a transport. */
export function createServer(options: ServerOptions = {}): McpServer {
  const context = createContext(options);
  const server = new McpServer(
    { name: "stiksound", title: "StikSound", version: packageJson.version },
    { instructions: INSTRUCTIONS }
  );
  registerProbeMedia(server, context);
  registerCreateSoundSticker(server, context);
  registerExportProject(server, context);
  return server;
}
