import { spawnSync } from "node:child_process";
import { resolveBinaries, runBinary } from "../src/index";

export const binaries = resolveBinaries();

/** Media tests need real binaries; they are skipped (not failed) on a machine without FFmpeg. */
export const hasFfmpeg =
  spawnSync(binaries.ffmpeg, ["-version"]).status === 0 && spawnSync(binaries.ffprobe, ["-version"]).status === 0;

/** Generates a fixture with ffmpeg's synthetic sources and returns the encoded bytes. */
export async function synth(args: string[]): Promise<Uint8Array> {
  const result = await runBinary(binaries.ffmpeg, ["-v", "error", ...args, "pipe:1"]);
  return result.stdout;
}

/** A PNG test pattern. `alpha` makes the left half fully transparent. */
export function pngFixture(width: number, height: number, alpha = false): Promise<Uint8Array> {
  const filter = alpha ? ["-vf", `format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lt(X,${width / 2}),0,255)'`] : [];
  return synth(["-f", "lavfi", "-i", `testsrc=size=${width}x${height}:rate=1`, ...filter, "-frames:v", "1", "-f", "image2pipe", "-c:v", "png"]);
}

/** A solid-color PNG. */
export function solidPng(width: number, height: number, color: string): Promise<Uint8Array> {
  return synth(["-f", "lavfi", "-i", `color=c=${color}:size=${width}x${height}:rate=1`, "-frames:v", "1", "-f", "image2pipe", "-c:v", "png"]);
}

/** An animated GIF of the given length at 10 fps. */
export function gifFixture(width: number, height: number, seconds: number): Promise<Uint8Array> {
  return synth(["-f", "lavfi", "-i", `testsrc=size=${width}x${height}:rate=10`, "-t", String(seconds), "-f", "gif"]);
}

/** A mono sine tone as 16-bit WAV. */
export function wavFixture(seconds: number, frequency = 440, sampleRate = 44100): Promise<Uint8Array> {
  return synth(["-f", "lavfi", "-i", `sine=frequency=${frequency}:sample_rate=${sampleRate}`, "-t", String(seconds), "-f", "wav"]);
}

/** A stereo sine tone as MP3. */
export function mp3Fixture(seconds: number): Promise<Uint8Array> {
  return synth(["-f", "lavfi", "-i", "sine=frequency=880:sample_rate=44100", "-t", String(seconds), "-ac", "2", "-f", "mp3"]);
}
