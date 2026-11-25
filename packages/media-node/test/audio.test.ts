import { writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { trimPcmSamples } from "@stiksound/media-web";
import { decodeAudio, encodeOggOpus, padPcmToDuration, probeFile, withTempDir } from "../src/index";
import { binaries, hasFfmpeg, mp3Fixture, solidPng, wavFixture } from "./support";

describe("packages/media-node padPcmToDuration", () => {
  it("pads with silence and leaves longer clips alone", () => {
    const pcm = { sampleRate: 48000 as const, channels: 1 as const, samples: new Float32Array(48000).fill(0.5), durationMs: 1000 };
    const padded = padPcmToDuration(pcm, 2500);
    expect(padded.samples.length).toBe(120000);
    expect(padded.durationMs).toBe(2500);
    expect(padded.samples[47999]).toBe(0.5);
    expect(padded.samples[48000]).toBe(0);
    expect(padPcmToDuration(pcm, 500)).toBe(pcm);
  });
});

describe.skipIf(!hasFfmpeg)("packages/media-node audio", () => {
  it("decodes WAV to mono 48 kHz and measures the duration from samples", async () => {
    const decoded = await decodeAudio(binaries, await wavFixture(2));
    expect(decoded.sourceSampleRate).toBe(44100);
    expect(decoded.sourceChannels).toBe(1);
    expect(Math.abs(decoded.durationMs - 2000)).toBeLessThanOrEqual(5);
    const peak = decoded.samples.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
    expect(peak).toBeGreaterThan(0.05);
  });

  it("decodes stereo MP3 and reports the source layout", async () => {
    const decoded = await decodeAudio(binaries, await mp3Fixture(3));
    expect(decoded.sourceChannels).toBe(2);
    expect(Math.abs(decoded.durationMs - 3000)).toBeLessThanOrEqual(60);
  });

  it("rejects a file without an audio track as unsupported-audio", async () => {
    await expect(decodeAudio(binaries, await solidPng(32, 32, "red"))).rejects.toThrowError(/unsupported-audio/);
    await expect(decodeAudio(binaries, new Uint8Array(64))).rejects.toThrowError(/unsupported-audio/);
  });

  it("encodes a trimmed clip as mono 48 kHz Ogg Opus of the same length", async () => {
    const decoded = await decodeAudio(binaries, await wavFixture(4));
    const pcm = trimPcmSamples(decoded.samples, decoded.sampleRate, 500, 2500, 1);
    const ogg = await encodeOggOpus(binaries, pcm);
    expect(new TextDecoder().decode(ogg.slice(0, 4))).toBe("OggS");

    const probed = await withTempDir(async (dir) => {
      const file = path.join(dir, "sound.ogg");
      await writeFile(file, ogg);
      return probeFile(binaries, file);
    });
    expect(probed.streams[0]).toMatchObject({ codecType: "audio", codecName: "opus", sampleRate: 48000, channels: 1 });
    expect(Math.abs(probed.durationMs - 2000)).toBeLessThanOrEqual(50);
  });
});
