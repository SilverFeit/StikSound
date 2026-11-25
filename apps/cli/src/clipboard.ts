import { pathToFileURL } from "node:url";
import { runBinary } from "./engine/ffmpeg";

export type ClipboardCopier = (filePath: string) => Promise<boolean>;

/**
 * JavaScript for Automation (macOS): writes the file URL to the general pasteboard and reads it
 * back so the caller knows whether the pasteboard actually holds the file. The path is passed as
 * argv[0] and is never spliced into script text.
 */
export const MACOS_COPY_SCRIPT = `
ObjC.import("AppKit");
function run(argv) {
  var url = $.NSURL.fileURLWithPath(argv[0]);
  var pasteboard = $.NSPasteboard.generalPasteboard;
  pasteboard.clearContents;
  if (!pasteboard.writeObjects($.NSArray.arrayWithObject(url))) return "failed";
  var stored = pasteboard.stringForType("public.file-url");
  if (stored.isNil()) return "failed";
  return $.NSURL.URLWithString(stored).path.js === url.path.js ? "copied" : "failed";
}`;

/**
 * Copies a file (not its path as plain text) to the system clipboard so it can be pasted directly.
 * - macOS: verified NSPasteboard copy via JXA (`osascript`).
 * - Windows: PowerShell `Set-Clipboard -LiteralPath` reading the path from an environment variable
 *   (no string interpolation or quoting hazard).
 * - Linux: `wl-copy` (Wayland) or `xclip` (X11) with `text/uri-list` when a graphical session is active.
 * Returns false on headless sessions or when clipboard tools are unavailable.
 */
export const copyFileToClipboard: ClipboardCopier = async (filePath) => {
  try {
    if (process.platform === "darwin") {
      const result = await runBinary("osascript", ["-l", "JavaScript", "-e", MACOS_COPY_SCRIPT, filePath], {
        timeoutMs: 10_000
      });
      return new TextDecoder().decode(result.stdout).trim() === "copied";
    }
    if (process.platform === "win32") {
      await runBinary(
        "powershell",
        ["-NoProfile", "-NonInteractive", "-Command", "Set-Clipboard -LiteralPath $env:STIKSOUND_CLIPBOARD_PATH"],
        { timeoutMs: 10_000, env: { STIKSOUND_CLIPBOARD_PATH: filePath } }
      );
      return true;
    }
    if (process.platform === "linux") {
      const uriList = new TextEncoder().encode(`${pathToFileURL(filePath).href}\r\n`);
      if (process.env.WAYLAND_DISPLAY) {
        try {
          await runBinary("wl-copy", ["--type", "text/uri-list"], { stdin: uriList, timeoutMs: 5_000 });
          return true;
        } catch {
          // Fall through to X11 if available.
        }
      }
      if (process.env.DISPLAY) {
        await runBinary("xclip", ["-selection", "clipboard", "-t", "text/uri-list"], {
          stdin: uriList,
          timeoutMs: 5_000
        });
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
};
