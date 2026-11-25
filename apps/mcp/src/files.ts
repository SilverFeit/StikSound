import { randomBytes } from "node:crypto";
import { link, mkdir, open, rename, stat, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { StikSoundError } from "@stiksound/core";
import { ToolInputError } from "./errors";

export interface InputFile {
  /** Absolute path the bytes were read from. */
  path: string;
  /** File name without its directory. */
  name: string;
  bytes: Uint8Array;
}

/** Folder used when a tool call does not name one, the same one the desktop app writes to. */
export function defaultOutputDir(): string {
  return path.join(os.homedir(), "Downloads", "StikSound");
}

/**
 * Expands a leading `~` and requires an absolute path. The server's working directory is whatever
 * the MCP client started it in, so a relative path would point somewhere the user cannot predict.
 */
export function resolveUserPath(raw: string, label: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new ToolInputError(`${label} is empty.`);
  }
  if (trimmed.includes("\0")) {
    throw new ToolInputError(`${label} contains a null byte.`);
  }
  const expanded =
    trimmed === "~" ? os.homedir() : trimmed.startsWith("~/") || trimmed.startsWith("~\\") ? path.join(os.homedir(), trimmed.slice(2)) : trimmed;
  if (!path.isAbsolute(expanded)) {
    throw new ToolInputError(`${label} must be an absolute path or start with ~/ (got "${raw}").`);
  }
  return path.normalize(expanded);
}

/** Reads a regular file, refusing anything larger than `maxBytes` before loading it. */
export async function readInputFile(rawPath: string, maxBytes: number, label: string): Promise<InputFile> {
  const filePath = resolveUserPath(rawPath, label);
  let handle;
  try {
    handle = await open(filePath, "r");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw new ToolInputError(`${label} does not exist: ${filePath}`);
    if (code === "EACCES" || code === "EPERM") throw new ToolInputError(`${label} is not readable: ${filePath}`);
    throw new ToolInputError(`${label} could not be opened: ${filePath}`);
  }
  try {
    const info = await handle.stat();
    if (!info.isFile()) {
      throw new ToolInputError(`${label} is not a file: ${filePath}`);
    }
    if (info.size === 0) {
      throw new ToolInputError(`${label} is empty: ${filePath}`);
    }
    if (info.size > maxBytes) {
      throw new StikSoundError("file-too-large", `${label} is ${info.size} bytes; the limit is ${maxBytes}.`);
    }
    const bytes = new Uint8Array(await handle.readFile());
    return { path: filePath, name: path.basename(filePath), bytes };
  } finally {
    await handle.close();
  }
}

function withSuffix(fileName: string, index: number): string {
  if (index === 1) return fileName;
  // Keep compound extensions such as ".stiksound.zip" together.
  const dot = fileName.indexOf(".");
  return dot <= 0 ? `${fileName}-${index}` : `${fileName.slice(0, dot)}-${index}${fileName.slice(dot)}`;
}

/**
 * Writes a finished artifact into `dir` without ever replacing an existing file: the bytes go to a
 * temp file first and are then hard-linked to the first free name (`name`, `name-2`, ...), which
 * fails atomically if that name was taken in the meantime. Returns the final path.
 */
export async function publishFile(dir: string, fileName: string, bytes: Uint8Array): Promise<string> {
  const safeName = path.basename(fileName);
  if (!safeName || safeName === "." || safeName === "..") {
    throw new ToolInputError(`Invalid output file name: ${fileName}`);
  }
  try {
    await mkdir(dir, { recursive: true });
  } catch {
    throw new ToolInputError(`Output folder could not be created: ${dir}`);
  }

  const tempPath = path.join(dir, `.${safeName}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    await writeFile(tempPath, bytes, { flag: "wx" });
  } catch {
    throw new ToolInputError(`Output folder is not writable: ${dir}`);
  }

  try {
    for (let index = 1; index <= 999; index++) {
      const target = path.join(dir, withSuffix(safeName, index));
      try {
        await link(tempPath, target);
        return target;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "EEXIST") continue;
        // Filesystems without hard links (FAT, some network shares): fall back to check-then-rename.
        if (await exists(target)) continue;
        await rename(tempPath, target);
        return target;
      }
    }
    throw new ToolInputError(`Too many files named ${safeName} in ${dir}.`);
  } finally {
    await unlink(tempPath).catch(() => undefined);
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}
