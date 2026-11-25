import { randomBytes } from "node:crypto";
import { link, mkdir, open, rename, stat, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { StikSoundError } from "@stiksound/core";
import { CliInputError } from "./errors";

export interface InputFile {
  /** Absolute path the bytes were read from. */
  path: string;
  /** File name without its directory. */
  name: string;
  bytes: Uint8Array;
}

export interface ResolvePathOptions {
  /** CLI commands allow relative paths (resolved against cwd). MCP mode requires absolute paths. */
  allowRelative?: boolean;
  cwd?: string;
}

/** Folder used when a command does not specify one, matching the desktop app's output directory. */
export function defaultOutputDir(): string {
  return path.join(os.homedir(), "Downloads", "StikSound");
}

/**
 * Expands a leading `~`, checks for null bytes, and resolves the path.
 * When `allowRelative` is true (CLI mode), relative paths resolve against `cwd`.
 * When `allowRelative` is false (MCP mode), only absolute paths or `~/...` are accepted.
 */
export function resolveUserPath(raw: string, label: string, options: ResolvePathOptions = {}): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new CliInputError(`${label} is empty.`);
  }
  if (trimmed.includes("\0")) {
    throw new CliInputError(`${label} contains a null byte.`);
  }
  const expanded =
    trimmed === "~"
      ? os.homedir()
      : trimmed.startsWith("~/") || trimmed.startsWith("~\\")
        ? path.join(os.homedir(), trimmed.slice(2))
        : trimmed;

  if (!path.isAbsolute(expanded)) {
    if (!options.allowRelative) {
      throw new CliInputError(`${label} must be an absolute path or start with ~/ (got "${raw}").`);
    }
    return path.resolve(options.cwd ?? process.cwd(), expanded);
  }
  return path.normalize(expanded);
}

/** Reads a regular file using a single open handle, refusing files larger than `maxBytes`. */
export async function readInputFile(
  rawPath: string,
  maxBytes: number,
  label: string,
  options: ResolvePathOptions = {}
): Promise<InputFile> {
  const filePath = resolveUserPath(rawPath, label, options);
  let handle;
  try {
    handle = await open(filePath, "r");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw new CliInputError(`${label} does not exist: ${filePath}`);
    if (code === "EACCES" || code === "EPERM") throw new CliInputError(`${label} is not readable: ${filePath}`);
    throw new CliInputError(`${label} could not be opened: ${filePath}`);
  }
  try {
    const info = await handle.stat();
    if (!info.isFile()) {
      throw new CliInputError(`${label} is not a file: ${filePath}`);
    }
    if (info.size === 0) {
      throw new CliInputError(`${label} is empty: ${filePath}`);
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
 * Writes a finished artifact into `dir` without ever replacing an existing file:
 * - Writes to a private temp file and hard-links to the first free name (`name`, `name-2`, ...).
 * - On filesystems without hard links (FAT, exFAT, some network shares), falls back to atomic
 *   `O_CREAT | O_EXCL` (`wx`) creation so an existing file can never be overwritten.
 */
export async function publishFile(dir: string, fileName: string, bytes: Uint8Array): Promise<string> {
  const safeName = path.basename(fileName);
  if (!safeName || safeName === "." || safeName === "..") {
    throw new CliInputError(`Invalid output file name: ${fileName}`);
  }
  try {
    await mkdir(dir, { recursive: true });
  } catch {
    throw new CliInputError(`Output folder could not be created: ${dir}`);
  }

  const tempPath = path.join(dir, `.${safeName}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    await writeFile(tempPath, bytes, { flag: "wx" });
  } catch {
    throw new CliInputError(`Output folder is not writable: ${dir}`);
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
        // Filesystems without hard links: atomic exclusive create avoids overwrite races.
        try {
          await writeFile(target, bytes, { flag: "wx" });
          return target;
        } catch (wxErr) {
          if ((wxErr as NodeJS.ErrnoException).code === "EEXIST") continue;
          throw new CliInputError(`Could not write output file: ${target}`);
        }
      }
    }
    throw new CliInputError(`Too many files named ${safeName} in ${dir}.`);
  } finally {
    await unlink(tempPath).catch(() => undefined);
  }
}

/**
 * Writes bytes to an explicit destination file path.
 * When `force` is false, refuses to overwrite an existing file atomically.
 * When `force` is true, writes to a sibling temp file and replaces atomically via rename.
 */
export async function writeExactFile(filePath: string, bytes: Uint8Array, force = false): Promise<string> {
  const dir = path.dirname(filePath);
  const safeName = path.basename(filePath);
  if (!safeName || safeName === "." || safeName === "..") {
    throw new CliInputError(`Invalid output file path: ${filePath}`);
  }
  try {
    await mkdir(dir, { recursive: true });
  } catch {
    throw new CliInputError(`Output folder could not be created: ${dir}`);
  }

  const tempPath = path.join(dir, `.${safeName}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    await writeFile(tempPath, bytes, { flag: "wx" });
  } catch {
    throw new CliInputError(`Output folder is not writable: ${dir}`);
  }

  try {
    if (force) {
      await rename(tempPath, filePath);
      return filePath;
    }
    try {
      await link(tempPath, filePath);
      return filePath;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EEXIST") {
        throw new CliInputError(`Output file already exists: ${filePath}. Pass --force to overwrite.`);
      }
      try {
        await writeFile(filePath, bytes, { flag: "wx" });
        return filePath;
      } catch (wxErr) {
        if ((wxErr as NodeJS.ErrnoException).code === "EEXIST") {
          throw new CliInputError(`Output file already exists: ${filePath}. Pass --force to overwrite.`);
        }
        throw new CliInputError(`Could not write output file: ${filePath}`);
      }
    }
  } finally {
    await unlink(tempPath).catch(() => undefined);
  }
}

/** Returns true if `targetPath` currently exists and is a directory. */
export async function isExistingDirectory(targetPath: string): Promise<boolean> {
  try {
    return (await stat(targetPath)).isDirectory();
  } catch {
    return false;
  }
}
