import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { publishFile, readInputFile, resolveUserPath, writeExactFile } from "../src/files";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "stiksound-cli-files-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("apps/cli file access", () => {
  it("expands ~ and resolves relative paths in CLI mode, but rejects them in strict MCP mode", () => {
    expect(resolveUserPath("~/Pictures/a.png", "image")).toBe(path.join(os.homedir(), "Pictures", "a.png"));
    expect(resolveUserPath("a.png", "image", { allowRelative: true, cwd: dir })).toBe(path.join(dir, "a.png"));
    expect(() => resolveUserPath("a.png", "image", { allowRelative: false })).toThrowError(/absolute path/);
    expect(() => resolveUserPath("  ", "image")).toThrowError(/empty/);
    expect(() => resolveUserPath("/tmp/a\0b", "image")).toThrowError(/null byte/);
  });

  it("reads regular files and rejects missing, empty, directory and oversized files", async () => {
    const file = path.join(dir, "in.bin");
    await writeFile(file, new Uint8Array([1, 2, 3, 4]));
    const input = await readInputFile(file, 10, "audio");
    expect(input.name).toBe("in.bin");
    expect([...input.bytes]).toEqual([1, 2, 3, 4]);

    await expect(readInputFile(path.join(dir, "nope"), 10, "audio")).rejects.toThrowError(/does not exist/);
    await expect(readInputFile(dir, 10, "audio")).rejects.toThrowError(/not a file/);
    await expect(readInputFile(file, 3, "audio")).rejects.toThrowError(/file-too-large/);
    await writeFile(path.join(dir, "empty"), new Uint8Array());
    await expect(readInputFile(path.join(dir, "empty"), 10, "audio")).rejects.toThrowError(/is empty/);
  });

  it("publishes without overwriting and preserves compound extensions", async () => {
    const out = path.join(dir, "nested", "out");
    const first = await publishFile(out, "meme-10s.mp4", new Uint8Array([1]));
    const second = await publishFile(out, "meme-10s.mp4", new Uint8Array([2]));
    const third = await publishFile(out, "meme.stiksound.zip", new Uint8Array([3]));
    const fourth = await publishFile(out, "meme.stiksound.zip", new Uint8Array([4]));

    expect(path.basename(first)).toBe("meme-10s.mp4");
    expect(path.basename(second)).toBe("meme-10s-2.mp4");
    expect(path.basename(third)).toBe("meme.stiksound.zip");
    expect(path.basename(fourth)).toBe("meme-2.stiksound.zip");
    expect([...(await readFile(first))]).toEqual([1]);
    expect([...(await readFile(second))]).toEqual([2]);
    expect((await readdir(out)).sort()).toEqual([
      "meme-10s-2.mp4",
      "meme-10s.mp4",
      "meme-2.stiksound.zip",
      "meme.stiksound.zip"
    ]);
  });

  it("strips path traversal from published output file names", async () => {
    const written = await publishFile(dir, "../../escape.mp4", new Uint8Array([1]));
    expect(written).toBe(path.join(dir, "escape.mp4"));
  });

  it("writeExactFile refuses overwrite without force and replaces atomically with force", async () => {
    const target = path.join(dir, "exact.mp4");
    await writeExactFile(target, new Uint8Array([10, 20]), false);
    expect([...(await readFile(target))]).toEqual([10, 20]);

    await expect(writeExactFile(target, new Uint8Array([30]), false)).rejects.toThrowError(/already exists/);
    expect([...(await readFile(target))]).toEqual([10, 20]);

    await writeExactFile(target, new Uint8Array([30, 40]), true);
    expect([...(await readFile(target))]).toEqual([30, 40]);
  });
});
