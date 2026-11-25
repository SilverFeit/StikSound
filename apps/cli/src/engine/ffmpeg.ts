import { spawn } from "node:child_process";
import path from "node:path";
import { StikSoundError } from "@stiksound/core";

/** Environment variables that point at specific binaries instead of the ones on PATH. */
export const FFMPEG_ENV = "STIKSOUND_FFMPEG";
export const FFPROBE_ENV = "STIKSOUND_FFPROBE";

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT_BYTES = 512 * 1024 * 1024;
const STDERR_TAIL_BYTES = 4000;

export interface FfmpegBinaries {
  ffmpeg: string;
  ffprobe: string;
}

export interface RunOptions {
  stdin?: Uint8Array;
  timeoutMs?: number;
  maxOutputBytes?: number;
  env?: NodeJS.ProcessEnv;
}

export interface RunResult {
  stdout: Uint8Array;
  stderr: string;
}

/** A binary that started and exited with a non-zero status. */
export class ProcessFailedError extends Error {
  constructor(
    public readonly binary: string,
    public readonly exitCode: number | null,
    public readonly stderr: string
  ) {
    super(`${path.basename(binary)} exited with status ${exitCode}: ${stderr.trim().split("\n").pop() ?? ""}`);
    this.name = "ProcessFailedError";
  }
}

function isWindowsPath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\");
}

/**
 * Resolves the ffmpeg and ffprobe binaries across macOS, Linux and Windows.
 * An explicit ffmpeg path implies its sibling ffprobe (preserving `.exe` on Windows)
 * unless STIKSOUND_FFPROBE is also set. Nothing is executed here.
 */
export function resolveBinaries(env: NodeJS.ProcessEnv = process.env): FfmpegBinaries {
  const ffmpeg = env[FFMPEG_ENV]?.trim() || "ffmpeg";
  const explicitProbe = env[FFPROBE_ENV]?.trim();
  if (explicitProbe) {
    return { ffmpeg, ffprobe: explicitProbe };
  }
  if (isWindowsPath(ffmpeg)) {
    const ext = path.win32.extname(ffmpeg);
    return { ffmpeg, ffprobe: path.win32.join(path.win32.dirname(ffmpeg), `ffprobe${ext}`) };
  }
  if (path.isAbsolute(ffmpeg)) {
    const ext = path.extname(ffmpeg);
    return { ffmpeg, ffprobe: path.join(path.dirname(ffmpeg), `ffprobe${ext}`) };
  }
  return { ffmpeg, ffprobe: "ffprobe" };
}

/**
 * Runs a binary with an argument array (never through a shell), feeds optional stdin and collects
 * stdout as bytes. Fails on a non-zero exit, a timeout or an oversized output.
 */
export function runBinary(binary: string, args: readonly string[], options: RunOptions = {}): Promise<RunResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

  return new Promise<RunResult>((resolve, reject) => {
    const child = spawn(binary, [...args], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: options.env ? { ...process.env, ...options.env } : undefined
    });
    const chunks: Buffer[] = [];
    let total = 0;
    let stderr = "";
    let settled = false;

    const killChild = (): void => {
      try {
        if (process.platform === "win32") {
          child.kill();
        } else {
          child.kill("SIGKILL");
        }
      } catch {
        // Ignore errors when the process has already exited.
      }
    };

    const finish = (err: Error | null, result?: RunResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) {
        killChild();
        reject(err);
      } else {
        resolve(result!);
      }
    };

    const timer = setTimeout(() => {
      finish(new StikSoundError("encode-failed", `${path.basename(binary)} timed out after ${timeoutMs} ms.`));
    }, timeoutMs);

    child.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        finish(
          new StikSoundError(
            "unsupported-codec",
            `${path.basename(binary)} was not found. Install FFmpeg or set ${FFMPEG_ENV} and ${FFPROBE_ENV}.`
          )
        );
        return;
      }
      finish(new StikSoundError("encode-failed", `Could not start ${path.basename(binary)}: ${err.message}`));
    });

    child.stdout.on("data", (chunk: Buffer) => {
      total += chunk.byteLength;
      if (total > maxOutputBytes) {
        finish(new StikSoundError("file-too-large", `${path.basename(binary)} produced more than ${maxOutputBytes} bytes.`));
        return;
      }
      chunks.push(chunk);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-STDERR_TAIL_BYTES);
    });

    child.on("close", (code) => {
      if (code !== 0) {
        finish(new ProcessFailedError(binary, code, stderr));
        return;
      }
      const stdout = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        stdout.set(chunk, offset);
        offset += chunk.byteLength;
      }
      finish(null, { stdout, stderr });
    });

    // A process that exits before reading all of stdin raises EPIPE here; the close handler reports it.
    child.stdin.on("error", () => undefined);
    if (options.stdin) {
      child.stdin.end(Buffer.from(options.stdin.buffer, options.stdin.byteOffset, options.stdin.byteLength));
    } else {
      child.stdin.end();
    }
  });
}

export interface FfmpegCapabilities {
  version: string;
  encoders: ReadonlySet<string>;
}

const capabilityCache = new Map<string, Promise<FfmpegCapabilities>>();

/** Reads the ffmpeg version and its encoder list once per binary path. */
export function detectCapabilities(ffmpeg: string): Promise<FfmpegCapabilities> {
  let cached = capabilityCache.get(ffmpeg);
  if (!cached) {
    cached = (async () => {
      const versionOut = await runBinary(ffmpeg, ["-hide_banner", "-version"], { timeoutMs: 15_000 });
      const version = /ffmpeg version (\S+)/.exec(new TextDecoder().decode(versionOut.stdout))?.[1] ?? "unknown";
      const encodersOut = await runBinary(ffmpeg, ["-hide_banner", "-encoders"], { timeoutMs: 15_000 });
      return { version, encoders: parseEncoderList(new TextDecoder().decode(encodersOut.stdout)) };
    })();
    capabilityCache.set(ffmpeg, cached);
    cached.catch(() => capabilityCache.delete(ffmpeg));
  }
  return cached;
}

/** Parses `ffmpeg -encoders` output: flag column, encoder name, description. */
export function parseEncoderList(text: string): Set<string> {
  const names = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s[VAS][A-Z.]{5}\s+(\S+)/.exec(line);
    if (match?.[1] && match[1] !== "=") {
      names.add(match[1]);
    }
  }
  return names;
}

/** First H.264 encoder this ffmpeg build has, best quality first. Null when it has none. */
export function pickH264Encoder(encoders: ReadonlySet<string>): string | null {
  for (const name of ["libx264", "h264_videotoolbox", "libopenh264", "h264_mf"]) {
    if (encoders.has(name)) return name;
  }
  return null;
}

/** libopus when present, otherwise ffmpeg's built-in Opus encoder. Null when it has neither. */
export function pickOpusEncoder(encoders: ReadonlySet<string>): string | null {
  if (encoders.has("libopus")) return "libopus";
  if (encoders.has("opus")) return "opus";
  return null;
}
