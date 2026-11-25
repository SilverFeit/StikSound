import { describe, expect, it } from "vitest";
import { findLoudestWindow, leadingSilenceMs, peakLevel } from "../src/loudness";

describe("apps/cli loudness helpers", () => {
  it("finds the loudest window inside a longer clip", () => {
    const sr = 1000;
    const samples = new Float32Array(sr * 12);
    // Loud burst from 7s to 10s
    for (let i = sr * 7; i < sr * 10; i++) {
      samples[i] = 0.8;
    }
    const win = findLoudestWindow(samples, sr, 5000);
    expect(win.end_ms - win.start_ms).toBe(5000);
    expect(win.start_ms).toBeGreaterThanOrEqual(5000);
    expect(win.start_ms).toBeLessThanOrEqual(7000);
    expect(leadingSilenceMs(samples, sr)).toBe(7000);
    expect(peakLevel(samples)).toBeCloseTo(0.8, 2);
  });

  it("returns the full duration when audio is shorter than window", () => {
    const samples = new Float32Array(1000 * 2).fill(0.2);
    expect(findLoudestWindow(samples, 1000, 5000)).toEqual({ start_ms: 0, end_ms: 2000 });
  });
});
