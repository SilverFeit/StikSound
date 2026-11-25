import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import encode, { init } from "@jsquash/webp/encode.js";
import { LIMITS, StikSoundError, type RgbaFrame512 } from "@stiksound/core";

const QUALITY_STEPS = [100, 90, 80, 70, 60, 50] as const;

let encoderReady: Promise<void> | null = null;

/**
 * The encoder is libwebp compiled to WebAssembly, so it does not depend on how the local ffmpeg
 * was built (many builds ship without libwebp). In Node the module is compiled from disk.
 */
export function ensureWebpEncoder(): Promise<void> {
  if (!encoderReady) {
    encoderReady = (async () => {
      const require = createRequire(import.meta.url);
      const wasmPath = require.resolve("@jsquash/webp/codec/enc/webp_enc_simd.wasm");
      const module = await WebAssembly.compile(await readFile(wasmPath));
      await init(module);
    })();
    encoderReady.catch(() => {
      encoderReady = null;
    });
  }
  return encoderReady;
}

/** Encodes one RGBA frame as WebP at a given quality (0 to 100), keeping alpha. */
export async function encodeWebpAtQuality(frame: RgbaFrame512, quality: number): Promise<Uint8Array> {
  if (frame.data.byteLength !== frame.width * frame.height * 4) {
    throw new StikSoundError("encode-failed", "RGBA frame size does not match its dimensions.");
  }
  await ensureWebpEncoder();
  const pixels = new Uint8ClampedArray(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength);
  const imageData = { data: pixels, width: frame.width, height: frame.height, colorSpace: "srgb" } as ImageData;
  try {
    return new Uint8Array(await encode(imageData, { quality }));
  } catch (err) {
    throw new StikSoundError("encode-failed", `WebP encoder failed: ${(err as Error).message}`);
  }
}

/** Static sticker WebP: the highest quality step that fits in the 100 KB sticker limit. */
export async function encodeWebpUnderLimit(frame: RgbaFrame512): Promise<Uint8Array> {
  for (const quality of QUALITY_STEPS) {
    const bytes = await encodeWebpAtQuality(frame, quality);
    if (bytes.byteLength <= LIMITS.MAX_STATIC_WEBP_BYTES) {
      return bytes;
    }
  }
  throw new StikSoundError("sticker-too-large", "WebP exceeded 100 KB even at quality 50.");
}
