import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { publishFile, readInputFile, resolveUserPath } from "../src/files";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "stiksound-mcp-test-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("apps/mcp file access", () => {
  it("expands ~ and rejects relative paths", () => {
    expect(resolveUserPath("~/Pictures/a.png", "image_path")).toBe(path.join(os.homedir(), "Pictures", "a.png"));
    expect(resolveUserPath(path.join(dir, "a.png"), "image_path")).toBe(path.join(dir, "a.png"));
    expect(() => resolveUserPath("a.png", "image_path")).toThrowError(/absolute path/);
    expect(() => resolveUserPath("  ", "image_path")).toThrowError(/empty/);
    expect(() => resolveUserPath("/tmp/a\0b", "image_path")).toThrowError(/null byte/);
  });

  it("reads a file and reports missing, empty, directory and oversized inputs", async () => {
    const file = path.join(dir, "in.bin");
    await writeFile(file, new Uint8Array([1, 2, 3, 4]));
    const input = await readInputFile(file, 10, "audio_path");
    expect(input.name).toBe("in.bin");
    expect([...input.bytes]).toEqual([1, 2, 3, 4]);

    await expect(readInputFile(path.join(dir, "nope"), 10, "audio_path")).rejects.toThrowError(/does not exist/);
    await expect(readInputFile(dir, 10, "audio_path")).rejects.toThrowError(/not a file/);
    await expect(readInputFile(file, 3, "audio_path")).rejects.toThrowError(/file-too-large/);
    await writeFile(path.join(dir, "empty"), new Uint8Array());
    await expect(readInputFile(path.join(dir, "empty"), 10, "audio_path")).rejects.toThrowError(/is empty/);
  });

  it("publishes without overwriting and leaves no temp files", async () => {
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
    expect((await readdir(out)).sort()).toEqual(["meme-10s-2.mp4", "meme-10s.mp4", "meme-2.stiksound.zip", "meme.stiksound.zip"]);
  });

  it("strips directories from the output name", async () => {
    const written = await publishFile(dir, "../../escape.mp4", new Uint8Array([1]));
    expect(written).toBe(path.join(dir, "escape.mp4"));
  });
});
