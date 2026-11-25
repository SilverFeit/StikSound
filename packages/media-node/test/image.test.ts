import { describe, expect, it } from "vitest";
import { LIMITS } from "@stiksound/core";
import { sniffImageHeader } from "@stiksound/media-web";
import {
  encodeWebpUnderLimit,
  parseProbeJson,
  probeStickerSource,
  renderStickerFrame,
  squareCropFilter
} from "../src/index";
import { binaries, hasFfmpeg, pngFixture, solidPng, synth } from "./support";

describe("packages/media-node probe parsing", () => {
  it("reads duration, rotation side data and audio facts from ffprobe JSON", () => {
    const probed = parseProbeJson(
      JSON.stringify({
        format: { duration: "3.500000" },
        streams: [
          { codec_type: "video", codec_name: "h264", width: 1920, height: 1080, side_data_list: [{ rotation: -90 }] },
          { codec_type: "audio", codec_name: "aac", sample_rate: "44100", channels: 2, duration: "3.480000" }
        ]
      })
    );
    expect(probed.durationMs).toBe(3500);
    expect(probed.streams[0]).toMatchObject({ codecType: "video", width: 1920, height: 1080, rotation: 270 });
    expect(probed.streams[1]).toMatchObject({ codecType: "audio", sampleRate: 44100, channels: 2, durationMs: 3480 });
  });

  it("builds the crop filter from the shared square-crop rule", () => {
    expect(squareCropFilter(1000, 600, 1, 0.5)).toEqual({
      filter: "crop=600:600:400:0,scale=512:512:flags=lanczos",
      outputSize: 512
    });
    expect(squareCropFilter(301, 301, 0.5, 0.5).outputSize).toBe(300);
  });
});

describe.skipIf(!hasFfmpeg)("packages/media-node images", () => {
  it("renders a centered 1:1 crop capped at 512 px", async () => {
    const png = await pngFixture(1000, 600);
    const frame = await renderStickerFrame(binaries, png, { crop_x: 0.5, crop_y: 0.5 });
    expect(frame.width).toBe(512);
    expect(frame.height).toBe(512);
    expect(frame.data.byteLength).toBe(512 * 512 * 4);
  });

  it("never upscales a small image and keeps the output even", async () => {
    const png = await pngFixture(201, 301);
    const frame = await renderStickerFrame(binaries, png, { crop_x: 0.5, crop_y: 0.5 });
    expect(frame.width).toBe(200);
    expect(frame.height).toBe(200);
  });

  it("moves the crop with the anchor", async () => {
    // Left half red, right half blue.
    const png = await synth([
      "-f", "lavfi", "-i", "color=c=red:size=200x100:rate=1",
      "-f", "lavfi", "-i", "color=c=blue:size=100x100:rate=1",
      "-filter_complex", "[0][1]overlay=100:0", "-frames:v", "1", "-f", "image2pipe", "-c:v", "png"
    ]);
    const left = await renderStickerFrame(binaries, png, { crop_x: 0, crop_y: 0.5 });
    const right = await renderStickerFrame(binaries, png, { crop_x: 1, crop_y: 0.5 });
    expect(left.data[0]).toBeGreaterThan(200);
    expect(left.data[2]).toBeLessThan(50);
    expect(right.data[0]).toBeLessThan(50);
    expect(right.data[2]).toBeGreaterThan(200);
  });

  it("keeps transparency through decode and WebP encode", async () => {
    const png = await pngFixture(256, 256, true);
    const frame = await renderStickerFrame(binaries, png, { crop_x: 0.5, crop_y: 0.5 });
    expect(frame.data[3]).toBe(0);
    expect(frame.data[(255 * 256 + 255) * 4 + 3]).toBe(255);

    const webp = await encodeWebpUnderLimit(frame);
    expect(webp.byteLength).toBeLessThanOrEqual(LIMITS.MAX_STATIC_WEBP_BYTES);
    expect(sniffImageHeader(webp)).toMatchObject({ format: "webp", width: 256, height: 256, has_alpha: true });
  });

  it("probes a video clip as an animated sticker source", async () => {
    const clip = await synth([
      "-f", "lavfi", "-i", "testsrc=size=320x240:rate=15", "-t", "2",
      "-pix_fmt", "yuv420p", "-movflags", "frag_keyframe+empty_moov", "-f", "mp4"
    ]);
    const info = await probeStickerSource(binaries, clip);
    expect(info).toMatchObject({ format: "mp4", width: 320, height: 240, animated: true, has_alpha: false });
    expect(Math.abs(info.duration_ms - 2000)).toBeLessThanOrEqual(100);
  });

  it("probes images from their header without running ffmpeg", async () => {
    const png = await solidPng(64, 48, "green");
    const info = await probeStickerSource({ ffmpeg: "missing", ffprobe: "missing" }, png);
    expect(info).toMatchObject({ format: "png", width: 64, height: 48, animated: false });
  });

  it("maps undecodable image bytes to unsupported-image", async () => {
    const png = await solidPng(64, 64, "green");
    const broken = png.slice(0, 60);
    await expect(renderStickerFrame(binaries, broken, {})).rejects.toThrowError(/unsupported-image/);
  });
});
