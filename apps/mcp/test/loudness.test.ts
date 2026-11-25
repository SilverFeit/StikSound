import { describe, expect, it } from "vitest";
import { findLoudestWindow, leadingSilenceMs, peakLevel } from "../src/loudness";

const RATE = 48000;

/** Silence with a constant-level burst between two times. */
function burst(totalMs: number, fromMs: number, toMs: number, level = 0.8): Float32Array {
  const samples = new Float32Array((totalMs / 1000) * RATE);
  samples.fill(level, (fromMs / 1000) * RATE, (toMs / 1000) * RATE);
  return samples;
}

describe("apps/mcp loudness analysis", () => {
  it("returns the whole clip when it is shorter than the window", () => {
    expect(findLoudestWindow(burst(3000, 0, 3000), RATE, 5000)).toEqual({ start_ms: 0, end_ms: 3000 });
  });

  it("finds the window that contains the loud part", () => {
    const window = findLoudestWindow(burst(30_000, 12_000, 16_000), RATE, 5000);
    expect(window.end_ms - window.start_ms).toBe(5000);
    expect(window.start_ms).toBeLessThanOrEqual(12_000);
    expect(window.end_ms).toBeGreaterThanOrEqual(16_000);
  });

  it("keeps the earliest window on a tie and stays inside the clip", () => {
    expect(findLoudestWindow(burst(20_000, 0, 20_000), RATE, 10_000)).toEqual({ start_ms: 0, end_ms: 10_000 });
    const tail = findLoudestWindow(burst(20_000, 19_000, 20_000), RATE, 10_000);
    expect(tail.end_ms).toBeLessThanOrEqual(20_000);
    expect(tail.end_ms).toBeGreaterThanOrEqual(19_900);
  });

  it("measures leading silence and peak level", () => {
    expect(leadingSilenceMs(burst(4000, 1500, 2000), RATE)).toBe(1500);
    expect(leadingSilenceMs(new Float32Array(RATE), RATE)).toBe(1000);
    expect(peakLevel(burst(1000, 0, 500, 0.25))).toBeCloseTo(0.25);
  });
});
