import { writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { VideoRenderRequest } from "@stiksound/core";
import { trimPcmSamples } from "@stiksound/media-web";
import {
  buildVideoArgs,
  decodeAudio,
  matteToFfmpegColor,
  probeFile,
  renderStickerVideo,
  runBinary,
  withTempDir,
  type VideoArgsInput
} from "../src/index";
import { binaries, gifFixture, hasFfmpeg, pngFixture, solidPng, synth, wavFixture } from "./support";

const BASE_ARGS: VideoArgsInput = {
  motion: "still",
  stickerPath: "/tmp/in/sticker.png",
  audioPath: "/tmp/in/audio.wav",
  outputPath: "/tmp/in/out.mp4",
  sourceWidth: 800,
  sourceHeight: 600,
  cropX: 0.5,
  cropY: 0.5,
  clipOffsetMs: 0,
  durationMs: 2500,
  matteColor: "#00ff7f",
  container: "mp4",
  videoEncoder: "libx264",
  audioEncoder: "aac"
};

describe("packages/media-node video arguments", () => {
  it("accepts only #RRGGBB matte colors", () => {
    expect(matteToFfmpegColor("#00ff7f")).toBe("0x00FF7F");
    expect(() => matteToFfmpegColor("red")).toThrowError(/encode-failed/);
    expect(() => matteToFfmpegColor("#fff;rm -rf")).toThrowError(/encode-failed/);
  });

  it("loops a still over the matte for MP4", () => {
    const args = buildVideoArgs(BASE_ARGS);
    expect(args.slice(args.indexOf("-loop"), args.indexOf("-loop") + 2)).toEqual(["-loop", "1"]);
    const graph = args[args.indexOf("-filter_complex") + 1]!;
    expect(graph).toContain("color=c=0x00FF7F:s=512x512:r=25[bg]");
    expect(graph).toContain("crop=600:600:100:0,scale=512:512:flags=lanczos");
    expect(args).toContain("+faststart");
    expect(args[args.indexOf("-t") + 1]).toBe("2.500");
    expect(args.at(-1)).toBe("/tmp/in/out.mp4");
  });

  it("loops a clip from its offset and keeps alpha for WebM", () => {
    const args = buildVideoArgs({
      ...BASE_ARGS,
      motion: "clip",
      clipOffsetMs: 1250,
      container: "webm-alpha",
      videoEncoder: "libvpx-vp9",
      audioEncoder: "libopus"
    });
    expect(args.slice(0, 6)).toEqual(["-v", "error", "-y", "-stream_loop", "-1", "-i"]);
    const graph = args[args.indexOf("-filter_complex") + 1]!;
    expect(graph.startsWith("[0:v]trim=start=1.250,setpts=PTS-STARTPTS,fps=24,crop=")).toBe(true);
    expect(graph.endsWith("format=yuva420p[v]")).toBe(true);
    expect(graph).not.toContain("color=");
  });
});

async function request(overrides: Partial<VideoRenderRequest>): Promise<VideoRenderRequest> {
  return {
    stickerBytes: await pngFixture(640, 480),
    stickerFormat: "png",
    animated: false,
    audioBytes: new Uint8Array(),
    audioFormat: "wav",
    startMs: 0,
    endMs: 2000,
    volume: 1,
    matteColor: "#FFFFFF",
    cropX: 0.5,
    cropY: 0.5,
    container: "mp4",
    ...overrides
  };
}

async function audioWindow(startMs: number, endMs: number) {
  const decoded = await decodeAudio(binaries, await wavFixture(6));
  return trimPcmSamples(decoded.samples, decoded.sampleRate, startMs, endMs, 1);
}

async function inspect(bytes: Uint8Array, extension: string) {
  return withTempDir(async (dir) => {
    const file = path.join(dir, `out.${extension}`);
    await writeFile(file, bytes);
    const probed = await probeFile(binaries, file);
    // libvpx decodes the alpha plane; ffmpeg's native VP9 decoder would drop it.
    const decoder = extension === "webm" ? ["-c:v", "libvpx-vp9"] : [];
    const frame = await runBinary(binaries.ffmpeg, [
      "-v", "error", ...decoder, "-i", file, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"
    ]);
    return { probed, firstFrame: frame.stdout };
  });
}

describe.skipIf(!hasFfmpeg)("packages/media-node video", () => {
  it("renders a square H.264 + AAC MP4 of the trimmed length", async () => {
    const result = await renderStickerVideo(binaries, await request({ endMs: 2000 }), await audioWindow(0, 2000));
    expect(result).toMatchObject({ mimeType: "video/mp4", extension: "mp4", hasAlpha: false });
    expect(Math.abs(result.durationMs - 2000)).toBeLessThanOrEqual(50);

    const { probed } = await inspect(result.bytes, "mp4");
    const video = probed.streams.find((s) => s.codecType === "video")!;
    const audio = probed.streams.find((s) => s.codecType === "audio")!;
    expect(video).toMatchObject({ codecName: "h264", width: 480, height: 480 });
    expect(audio).toMatchObject({ codecName: "aac", sampleRate: 48000, channels: 1 });
  }, 60_000);

  it.each([[1249], [2049], [777]])("stays inside the duration tolerance for an awkward %i ms window", async (ms) => {
    for (const container of ["mp4", "webm-alpha"] as const) {
      const result = await renderStickerVideo(binaries, await request({ endMs: ms, container }), await audioWindow(0, ms));
      expect(Math.abs(result.durationMs - ms)).toBeLessThanOrEqual(50);
    }
  }, 60_000);

  it("fills transparency with the matte color in MP4", async () => {
    const transparent = await synth([
      "-f", "lavfi", "-i", "color=c=black@0.0:size=128x128:rate=1,format=rgba",
      "-frames:v", "1", "-f", "image2pipe", "-c:v", "png"
    ]);
    const result = await renderStickerVideo(
      binaries,
      await request({ stickerBytes: transparent, matteColor: "#0000FF", endMs: 500 }),
      await audioWindow(0, 500)
    );
    const { firstFrame } = await inspect(result.bytes, "mp4");
    expect(firstFrame[0]).toBeLessThan(40);
    expect(firstFrame[1]).toBeLessThan(40);
    expect(firstFrame[2]).toBeGreaterThan(200);
  }, 60_000);

  it("loops an animated GIF up to the minimum duration and pads the audio", async () => {
    const result = await renderStickerVideo(
      binaries,
      await request({
        stickerBytes: await gifFixture(160, 160, 1),
        stickerFormat: "gif",
        animated: true,
        endMs: 1000,
        minDurationMs: 3000
      }),
      await audioWindow(0, 1000)
    );
    expect(Math.abs(result.durationMs - 3000)).toBeLessThanOrEqual(50);
    const { probed } = await inspect(result.bytes, "mp4");
    const audio = probed.streams.find((s) => s.codecType === "audio")!;
    expect(Math.abs(audio.durationMs - 3000)).toBeLessThanOrEqual(80);
  }, 60_000);

  it("renders a clip segment that starts at the offset and wraps around", async () => {
    // First second red, second second blue.
    const clip = await synth([
      "-f", "lavfi", "-i", "color=c=red:size=160x120:rate=24:duration=1",
      "-f", "lavfi", "-i", "color=c=blue:size=160x120:rate=24:duration=1",
      "-filter_complex", "[0][1]concat=n=2:v=1[v]", "-map", "[v]",
      "-pix_fmt", "yuv420p", "-movflags", "frag_keyframe+empty_moov", "-f", "mp4"
    ]);
    const result = await renderStickerVideo(
      binaries,
      await request({
        stickerBytes: clip,
        stickerFormat: "mp4",
        animated: true,
        stickerWidth: 160,
        stickerHeight: 120,
        videoOffsetMs: 1200,
        endMs: 1500
      }),
      await audioWindow(0, 1500)
    );
    expect(Math.abs(result.durationMs - 1500)).toBeLessThanOrEqual(50);
    const { probed, firstFrame } = await inspect(result.bytes, "mp4");
    expect(probed.streams.find((s) => s.codecType === "video")).toMatchObject({ width: 120, height: 120 });
    // The segment starts 1.2 s in, inside the blue half.
    expect(firstFrame[2]).toBeGreaterThan(150);
    expect(firstFrame[0]).toBeLessThan(80);
  }, 60_000);

  it("keeps the alpha channel in WebM", async () => {
    const result = await renderStickerVideo(
      binaries,
      await request({ stickerBytes: await pngFixture(256, 256, true), container: "webm-alpha", endMs: 800 }),
      await audioWindow(0, 800)
    );
    expect(result).toMatchObject({ mimeType: "video/webm", extension: "webm", hasAlpha: true });
    expect(Math.abs(result.durationMs - 800)).toBeLessThanOrEqual(50);

    const { probed, firstFrame } = await inspect(result.bytes, "webm");
    expect(probed.streams.find((s) => s.codecType === "video")).toMatchObject({ codecName: "vp9", width: 256, height: 256 });
    expect(probed.streams.find((s) => s.codecType === "audio")).toMatchObject({ codecName: "opus" });
    expect(firstFrame[3]).toBeLessThan(20);
    expect(firstFrame[(128 * 256 + 250) * 4 + 3]).toBeGreaterThan(235);
  }, 60_000);

  it("rejects an invalid matte before running ffmpeg", async () => {
    await expect(
      renderStickerVideo(binaries, await request({ stickerBytes: await solidPng(64, 64, "red"), matteColor: "white" }), await audioWindow(0, 2000))
    ).rejects.toThrowError(/Invalid matte color/);
  });
});
