/** Energy is summed in blocks of this length, so a window start has 20 ms resolution. */
const BLOCK_MS = 20;
/** Peak level below which audio counts as silence (about -46 dBFS). */
const SILENCE_THRESHOLD = 0.005;

export interface TrimWindow {
  start_ms: number;
  end_ms: number;
}

/**
 * The window of `windowMs` with the most energy. A sound effect usually has dead air before or
 * after the part people recognize; this gives an agent a better default than "the first N seconds".
 * Audio shorter than the window is returned whole.
 */
export function findLoudestWindow(samples: Float32Array, sampleRate: number, windowMs: number): TrimWindow {
  const totalMs = Math.floor((samples.length / sampleRate) * 1000);
  if (totalMs <= windowMs) {
    return { start_ms: 0, end_ms: totalMs };
  }

  const blockSize = Math.max(1, Math.round((sampleRate * BLOCK_MS) / 1000));
  const blockCount = Math.floor(samples.length / blockSize);
  const energy = new Float64Array(blockCount);
  for (let block = 0; block < blockCount; block++) {
    let sum = 0;
    const offset = block * blockSize;
    for (let i = 0; i < blockSize; i++) {
      const value = samples[offset + i]!;
      sum += value * value;
    }
    energy[block] = sum;
  }

  const windowBlocks = Math.min(blockCount, Math.round(windowMs / BLOCK_MS));
  let current = 0;
  for (let block = 0; block < windowBlocks; block++) {
    current += energy[block]!;
  }
  let best = current;
  let bestStart = 0;
  for (let start = 1; start + windowBlocks <= blockCount; start++) {
    current += energy[start + windowBlocks - 1]! - energy[start - 1]!;
    // Require a real improvement so that ties keep the earliest window.
    if (current > best * 1.0001) {
      best = current;
      bestStart = start;
    }
  }

  const startMs = Math.min(bestStart * BLOCK_MS, totalMs - windowMs);
  return { start_ms: startMs, end_ms: startMs + windowMs };
}

/** Milliseconds of silence before the first audible sample. Equals the duration when all is silent. */
export function leadingSilenceMs(samples: Float32Array, sampleRate: number): number {
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]!) > SILENCE_THRESHOLD) {
      return Math.floor((i / sampleRate) * 1000);
    }
  }
  return Math.floor((samples.length / sampleRate) * 1000);
}

/** Largest absolute sample value, 0 to 1. */
export function peakLevel(samples: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const value = Math.abs(samples[i]!);
    if (value > peak) peak = value;
  }
  return Math.min(1, peak);
}
