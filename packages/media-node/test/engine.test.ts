import { describe, expect, it } from "vitest";
import { LIMITS, ProjectController, createProject, type ProjectManifest } from "@stiksound/core";
import { sniffImageHeader, sniffVideoContainer } from "@stiksound/media-web";
import { NodeMediaEngine } from "../src/index";
import { gifFixture, hasFfmpeg, mp3Fixture, pngFixture, synth, wavFixture } from "./support";

describe("packages/media-node NodeMediaEngine zip", () => {
  const engine = new NodeMediaEngine();

  it("round-trips entries and rejects unsafe paths", async () => {
    const zipped = await engine.zip([
      { path: "manifest.json", bytes: new TextEncoder().encode("{}") },
      { path: "assets/a.bin", bytes: new Uint8Array([1, 2, 3]) }
    ]);
    const entries = await engine.unzip(zipped);
    expect(entries.map((e) => e.path).sort()).toEqual(["assets/a.bin", "manifest.json"]);
    await expect(engine.zip([{ path: "../evil", bytes: new Uint8Array(1) }])).rejects.toThrowError(/package-invalid/);
    await expect(engine.unzip(new Uint8Array([1, 2, 3, 4]))).rejects.toThrowError(/package-invalid/);
  });
});

/** The use cases run unchanged on the Node engine; these check the acceptance properties of each profile. */
describe.skipIf(!hasFfmpeg)("packages/media-node NodeMediaEngine with ProjectController", () => {
  const engine = new NodeMediaEngine();
  const controller = new ProjectController(engine);

  it("exports the default 10 s MP4 from a PNG and an MP3", async () => {
    let state = createProject("Air Horn");
    state = await controller.importSticker(state, await pngFixture(900, 700), "horn.png");
    state = await controller.importAudioFile(state, await mp3Fixture(14), "horn.mp3");
    expect(state.manifest.audios[0]).toMatchObject({ format: "mp3", channels: 2 });
    expect(state.manifest.associations[0]).toMatchObject({ start_ms: 0, end_ms: 10_000 });
    expect(state.waveformPeaks?.buckets).toBe(LIMITS.WAVEFORM_BUCKETS);

    state = controller.updateAudioEdit(state, { start_ms: 2000, end_ms: 5000 });
    const artifact = await controller.exportProject(state);
    expect(artifact.fileName).toBe("air-horn-10s.mp4");
    expect(sniffVideoContainer(artifact.bytes)).toBe("mp4");
    expect(Math.abs(artifact.durationMs! - 3000)).toBeLessThanOrEqual(LIMITS.DURATION_TOLERANCE_MS);
  }, 60_000);

  it("exports a static WebP under 100 KB", async () => {
    let state = createProject("Still", "standard-webp");
    state = await controller.importSticker(state, await pngFixture(1024, 1024, true), "still.png");
    const artifact = await controller.exportProject(state);
    expect(artifact.fileName).toBe("still-sticker.webp");
    expect(artifact.bytes.byteLength).toBeLessThanOrEqual(LIMITS.MAX_STATIC_WEBP_BYTES);
    expect(sniffImageHeader(artifact.bytes)).toMatchObject({ format: "webp", width: 512, height: 512, has_alpha: true });
  }, 60_000);

  it("exports a sound bundle with a WebP, real Ogg Opus and a valid manifest", async () => {
    let state = createProject("Bundle", "sound-bundle");
    state = await controller.importSticker(state, await pngFixture(600, 600), "b.png");
    state = await controller.importAudioFile(state, await wavFixture(3), "b.wav");
    const artifact = await controller.exportProject(state);
    expect(artifact.fileName).toBe("bundle-stiksound.zip");

    const entries = new Map((await engine.unzip(artifact.bytes)).map((e) => [e.path, e.bytes]));
    expect([...entries.keys()].sort()).toEqual(["manifest.json", "sound.ogg", "sticker.webp"]);
    expect(new TextDecoder().decode(entries.get("sound.ogg")!.slice(0, 4))).toBe("OggS");
    const manifest = JSON.parse(new TextDecoder().decode(entries.get("manifest.json")!)) as ProjectManifest;
    expect(manifest.bundle).toMatchObject({ kind: "sound-bundle", whatsapp_native: false });
  }, 60_000);

  it("loops an animated GIF for the trimmed window in WebM with alpha", async () => {
    let state = createProject("Loop", "video-webm-alpha");
    state = await controller.importSticker(state, await gifFixture(200, 200, 1), "loop.gif", 5000);
    state = await controller.importAudioFile(state, await wavFixture(8), "loop.wav", { type: "local" }, 5000);
    expect(state.manifest.associations[0]).toMatchObject({ start_ms: 0, end_ms: 5000 });
    state = controller.updateAudioEdit(state, { start_ms: 1000, end_ms: 3000 }, 5000);
    const artifact = await controller.exportProject(state, undefined, 5000);
    expect(artifact.fileName).toBe("loop-5s.webm");
    expect(sniffVideoContainer(artifact.bytes)).toBe("webm");
    expect(Math.abs(artifact.durationMs! - 2000)).toBeLessThanOrEqual(LIMITS.DURATION_TOLERANCE_MS);
  }, 60_000);

  it("uses a video sticker's own sound and falls back to silence without one", async () => {
    const withSound = await synth([
      "-f", "lavfi", "-i", "testsrc=size=320x240:rate=24", "-f", "lavfi", "-i", "sine=frequency=500",
      "-t", "3", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "frag_keyframe+empty_moov", "-f", "mp4"
    ]);
    let state = await controller.importSticker(createProject("Clip"), withSound, "clip.mp4");
    expect(state.manifest.stickers[0]).toMatchObject({ format: "mp4", width: 320, height: 240 });
    expect(state.manifest.audios[0]?.source.type).toBe("video-track");
    expect(Math.abs(state.manifest.audios[0]!.duration_ms - 3000)).toBeLessThanOrEqual(100);
    const artifact = await controller.exportProject(state);
    expect(Math.abs(artifact.durationMs! - state.manifest.associations[0]!.end_ms)).toBeLessThanOrEqual(
      LIMITS.DURATION_TOLERANCE_MS
    );

    const mute = await synth([
      "-f", "lavfi", "-i", "testsrc=size=320x240:rate=24", "-t", "2",
      "-pix_fmt", "yuv420p", "-movflags", "frag_keyframe+empty_moov", "-f", "mp4"
    ]);
    state = await controller.importSticker(createProject("Mute"), mute, "mute.mp4");
    expect(state.manifest.audios[0]?.source_name).toBe("Video sin sonido");
  }, 60_000);

  it("round-trips a saved project and exports it again", async () => {
    let state = createProject("Saved");
    state = await controller.importSticker(state, await pngFixture(512, 512), "s.png");
    state = await controller.importAudioFile(state, await wavFixture(2), "s.wav");
    const reopened = await controller.openProject(await controller.saveProject(state));
    expect(reopened.manifest.project.name).toBe("Saved");
    expect(reopened.waveformPeaks?.buckets).toBe(LIMITS.WAVEFORM_BUCKETS);
    const artifact = await controller.exportProject(reopened);
    expect(Math.abs(artifact.durationMs! - 2000)).toBeLessThanOrEqual(LIMITS.DURATION_TOLERANCE_MS);
  }, 60_000);

  it("keeps the import limits: audio longer than 3 minutes is rejected", async () => {
    const long = await synth(["-f", "lavfi", "-i", "sine=frequency=300:sample_rate=8000", "-t", "185", "-f", "wav"]);
    await expect(controller.importAudioFile(createProject(), long, "long.wav")).rejects.toThrowError(/file-too-large/);
  }, 60_000);
});
