import { runBinary } from "@stiksound/media-node";

export type ClipboardCopier = (filePath: string) => Promise<boolean>;

/**
 * Puts a file (not its path as text) on the system clipboard so it can be pasted into a chat.
 * Supported on macOS and Windows, the same platforms and commands as the desktop app. Returns
 * false where it is not supported or the command fails.
 */
export const copyFileToClipboard: ClipboardCopier = async (filePath) => {
  try {
    if (process.platform === "darwin") {
      const escaped = filePath.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      await runBinary("osascript", ["-e", `set the clipboard to (POSIX file "${escaped}")`], { timeoutMs: 10_000 });
      return true;
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
