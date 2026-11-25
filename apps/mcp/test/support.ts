import { spawnSync } from "node:child_process";
import { resolveBinaries, runBinary } from "@stiksound/media-node";

const binaries = resolveBinaries();

/** Tool tests render real media; they are skipped (not failed) on a machine without FFmpeg. */
export const hasFfmpeg =
  spawnSync(binaries.ffmpeg, ["-version"]).status === 0 && spawnSync(binaries.ffprobe, ["-version"]).status === 0;

async function synth(args: string[]): Promise<Uint8Array> {
  return (await runBinary(binaries.ffmpeg, ["-v", "error", ...args, "pipe:1"])).stdout;
}

export function pngFixture(width: number, height: number): Promise<Uint8Array> {
  return synth(["-f", "lavfi", "-i", `testsrc=size=${width}x${height}:rate=1`, "-frames:v", "1", "-f", "image2pipe", "-c:v", "png"]);
}

export function gifFixture(seconds: number): Promise<Uint8Array> {
  return synth(["-f", "lavfi", "-i", "testsrc=size=160x160:rate=10", "-t", String(seconds), "-f", "gif"]);
}

/** Silence, then a tone from `toneFromS` to the end. */
export function lateToneMp3(totalS: number, toneFromS: number): Promise<Uint8Array> {
  return synth([
    "-f", "lavfi", "-i", `sine=frequency=660:sample_rate=44100:duration=${totalS}`,
    "-af", `volume=enable='lt(t,${toneFromS})':volume=0`,
    "-f", "mp3"
  ]);
}

export function toneWav(seconds: number): Promise<Uint8Array> {
  return synth(["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100", "-t", String(seconds), "-f", "wav"]);
}
