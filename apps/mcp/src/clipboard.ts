import { runBinary } from "@stiksound/media-node";

export type ClipboardCopier = (filePath: string) => Promise<boolean>;

/**
 * JavaScript for Automation: writes the file URL to the general pasteboard and reads it back, so
 * the caller learns whether the clipboard really holds the file. The path arrives as an argument
 * and is never spliced into the script text.
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
 * Puts a file (not its path as text) on the system clipboard so it can be pasted into a chat.
 * Supported on macOS and Windows. Returns false where it is not supported or the copy fails.
 *
 * On macOS the result is confirmed by reading the pasteboard back: a command that exits 0 is not
 * proof that the clipboard changed, and the tool reports this value to the user as a fact.
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
      const escaped = filePath.replace(/'/g, "''");
      await runBinary(
        "powershell",
        ["-NoProfile", "-NonInteractive", "-Command", `Set-Clipboard -LiteralPath '${escaped}'`],
        { timeoutMs: 10_000 }
      );
      return true;
    }
  } catch {
    return false;
  }
  return false;
};
