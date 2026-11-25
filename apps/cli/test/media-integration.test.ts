import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LIMITS, ProjectController, createProject, type ProjectManifest } from "@stiksound/core";
import { sniffImageHeader, sniffVideoContainer } from "@stiksound/media-web";
import { runCli } from "../src/cli";
import { NodeMediaEngine, probeFile, runBinary, withTempDir } from "../src/engine";
import { binaries, gifFixture, hasFfmpeg, lateToneMp3, mp3Fixture, pngFixture, synth, wavFixture } from "./support";

describe("apps/cli NodeMediaEngine zip validation", () => {
  const engine = new NodeMediaEngine();

  it("round-trips project and bundle paths and rejects unsafe paths", async () => {
    const zipped = await engine.zip([
      { path: "manifest.json", bytes: new TextEncoder().encode("{}") },
      { path: "sticker.webp", bytes: new Uint8Array([1, 2]) },
      { path: "sound.ogg", bytes: new Uint8Array([3, 4]) },
      { path: "assets/a.bin", bytes: new Uint8Array([5, 6]) }
    ]);
    const entries = await engine.unzip(zipped);
    expect(entries.map((e) => e.path).sort()).toEqual(["assets/a.bin", "manifest.json", "sound.ogg", "sticker.webp"]);
    await expect(engine.zip([{ path: "../evil", bytes: new Uint8Array(1) }])).rejects.toThrowError(/package-invalid/);
    await expect(engine.unzip(new Uint8Array([1, 2, 3, 4]))).rejects.toThrowError(/package-invalid/);
  });
});

async function inspectRendered(bytes: Uint8Array, extension: string) {
  return withTempDir(async (dir) => {
    const file = path.join(dir, `out.${extension}`);
    await writeFile(file, bytes);
    const probed = await probeFile(binaries, file);
    const decoder = extension === "webm" ? ["-c:v", "libvpx-vp9"] : [];
    const frame = await runBinary(binaries.ffmpeg, [
      "-v", "error", ...decoder, "-i", file, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"
    ]);
    return { probed, firstFrame: frame.stdout };
  });
}

describe.skipIf(!hasFfmpeg)("apps/cli real FFmpeg integration", () => {
  const engine = new NodeMediaEngine();
  const controller = new ProjectController(engine);

  it("renders MP4, WebM with alpha, sound-bundle (real Ogg Opus) and static WebP <= 100 KB", async () => {
    // 1. MP4 from PNG + MP3
    let state = createProject("Air Horn");
    state = await controller.importSticker(state, await pngFixture(900, 700, true), "horn.png");
    state = await controller.importAudioFile(state, await mp3Fixture(6), "horn.mp3");
    state = controller.updateAudioEdit(state, { start_ms: 1000, end_ms: 3000 });
    const mp4 = await controller.exportProject(state, "video-mp4");
    expect(sniffVideoContainer(mp4.bytes)).toBe("mp4");
    expect(Math.abs(mp4.durationMs! - 2000)).toBeLessThanOrEqual(LIMITS.DURATION_TOLERANCE_MS);

    // 2. WebM keeping alpha channel
    const webm = await controller.exportProject(state, "video-webm-alpha");
    expect(sniffVideoContainer(webm.bytes)).toBe("webm");
    const webmInfo = await inspectRendered(webm.bytes, "webm");
    expect(webmInfo.probed.streams.find((s) => s.codecType === "video")).toMatchObject({ codecName: "vp9", width: 512, height: 512 });
    expect(webmInfo.firstFrame[3]).toBeLessThan(20); // left half transparent

    // 3. Sound bundle with real Ogg Opus
    const bundle = await controller.exportProject(state, "sound-bundle");
    const entries = new Map((await engine.unzip(bundle.bytes)).map((e) => [e.path, e.bytes]));
    expect([...entries.keys()].sort()).toEqual(["manifest.json", "sound.ogg", "sticker.webp"]);
    expect(new TextDecoder().decode(entries.get("sound.ogg")!.slice(0, 4))).toBe("OggS");
    const manifest = JSON.parse(new TextDecoder().decode(entries.get("manifest.json")!)) as ProjectManifest;
    expect(manifest.bundle?.whatsapp_native).toBe(false);

    // 4. Static WebP under 100 KB
    const webp = await controller.exportProject(state, "standard-webp");
    expect(webp.bytes.byteLength).toBeLessThanOrEqual(LIMITS.MAX_STATIC_WEBP_BYTES);
    expect(sniffImageHeader(webp.bytes)).toMatchObject({ format: "webp", width: 512, height: 512, has_alpha: true });
  }, 90_000);

  it("handles animated GIF looping and video clips with and without sound via CLI end-to-end", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "stiksound-cli-e2e-"));
    try {
      const gifPath = path.join(dir, "loop.gif");
      const mp3Path = path.join(dir, "late.mp3");
      const muteClipPath = path.join(dir, "mute.mp4");
      const outFile = path.join(dir, "gif-out.mp4");
      await Promise.all([
        writeFile(gifPath, await gifFixture(200, 200, 1)),
        writeFile(mp3Path, await lateToneMp3(10, 6)),
        writeFile(
          muteClipPath,
          await synth([
            "-f", "lavfi", "-i", "testsrc=size=320x240:rate=24", "-t", "2",
            "-pix_fmt", "yuv420p", "-movflags", "frag_keyframe+empty_moov", "-f", "mp4"
          ])
        )
      ]);

      const lines: string[] = [];
      const probeCode = await runCli(["probe", muteClipPath, "--json"], {
        io: { stdout: (l) => lines.push(l), stderr: () => undefined }
      });
      expect(probeCode).toBe(0);
      expect(JSON.parse(lines.join("\n"))).toMatchObject({ kind: "video", has_sound: false });

      const outLines: string[] = [];
      const createCode = await runCli(
        ["create", gifPath, "-a", mp3Path, "--trim", "loudest", "-d", "5", "-o", outFile, "--json"],
        { io: { stdout: (l) => outLines.push(l), stderr: () => undefined } }
      );
      expect(createCode).toBe(0);
      const created = JSON.parse(outLines.join("\n"));
      expect(created.output_path).toBe(outFile);
      expect(Math.abs(created.duration_ms - 5000)).toBeLessThanOrEqual(LIMITS.DURATION_TOLERANCE_MS);
      expect(sniffVideoContainer(new Uint8Array(await readFile(outFile)))).toBe("mp4");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 90_000);

  it("reports true duration when audio exceeds the 3 minute import limit", async () => {
    const longWav = await synth(["-f", "lavfi", "-i", "sine=frequency=300:sample_rate=8000", "-t", "210", "-f", "wav"]);
    await expect(controller.importAudioFile(createProject(), longWav, "long.wav")).rejects.toThrowError(/file-too-large/);

    const dir = await mkdtemp(path.join(os.tmpdir(), "stiksound-cli-long-"));
    try {
      const longPath = path.join(dir, "long.wav");
      await writeFile(longPath, longWav);
      const out: string[] = [];
      const code = await runCli(["probe", longPath, "--json"], {
        io: { stdout: (l) => out.push(l), stderr: () => undefined }
      });
      expect(code).toBe(0);
      const data = JSON.parse(out.join("\n"));
      expect(data.within_import_limit).toBe(false);
      expect(data.duration_ms).toBeGreaterThanOrEqual(209_000);
      expect(data.analysis_truncated).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("passes doctor when FFmpeg is installed", async () => {
    const out: string[] = [];
    const code = await runCli(["doctor", "--json"], {
      io: { stdout: (l) => out.push(l), stderr: () => undefined }
    });
    expect(code).toBe(0);
    expect(JSON.parse(out.join("\n")).ok).toBe(true);
  }, 30_000);
});
