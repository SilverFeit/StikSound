import { describe, expect, it } from "vitest";
import {
  parseEncoderList,
  pickH264Encoder,
  pickOpusEncoder,
  resolveBinaries,
  runBinary
} from "../src/index";

const ENCODERS_SAMPLE = `Encoders:
 V..... = Video
 A..... = Audio
 ------
 V....D libx264              libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (codec h264)
 V....D h264_videotoolbox    VideoToolbox H.264 Encoder (codec h264)
 V....D libvpx-vp9           libvpx VP9 (codec vp9)
 A....D aac                  AAC (Advanced Audio Coding)
 A..X.D opus                 Opus
 A....D libopus              libopus Opus (codec opus)
`;

describe("packages/media-node ffmpeg helpers", () => {
  it("parses encoder names and skips the legend lines", () => {
    const encoders = parseEncoderList(ENCODERS_SAMPLE);
    expect([...encoders].sort()).toEqual(["aac", "h264_videotoolbox", "libopus", "libvpx-vp9", "libx264", "opus"]);
  });

  it("prefers libx264 and libopus, then falls back", () => {
    expect(pickH264Encoder(new Set(["h264_videotoolbox", "libx264"]))).toBe("libx264");
    expect(pickH264Encoder(new Set(["libopenh264"]))).toBe("libopenh264");
    expect(pickH264Encoder(new Set(["libvpx-vp9"]))).toBeNull();
    expect(pickOpusEncoder(new Set(["opus", "libopus"]))).toBe("libopus");
    expect(pickOpusEncoder(new Set(["opus"]))).toBe("opus");
    expect(pickOpusEncoder(new Set())).toBeNull();
  });

  it("resolves binaries from PATH, from an explicit ffmpeg and from both variables", () => {
    expect(resolveBinaries({})).toEqual({ ffmpeg: "ffmpeg", ffprobe: "ffprobe" });
    expect(resolveBinaries({ STIKSOUND_FFMPEG: "/opt/ff/bin/ffmpeg" })).toEqual({
      ffmpeg: "/opt/ff/bin/ffmpeg",
      ffprobe: "/opt/ff/bin/ffprobe"
    });
    expect(resolveBinaries({ STIKSOUND_FFMPEG: "/a/ffmpeg", STIKSOUND_FFPROBE: "/b/ffprobe" })).toEqual({
      ffmpeg: "/a/ffmpeg",
      ffprobe: "/b/ffprobe"
    });
  });

  it("reports a missing binary as unsupported-codec", async () => {
    await expect(runBinary("stiksound-no-such-binary", ["-version"])).rejects.toThrowError(/unsupported-codec/);
  });

  it("passes stdin through and returns stdout bytes", async () => {
    const script = "process.stdin.on('data', (d) => process.stdout.write(d))";
    const result = await runBinary(process.execPath, ["-e", script], { stdin: new Uint8Array([1, 2, 3]) });
    expect([...result.stdout]).toEqual([1, 2, 3]);
  });

  it("rejects on a non-zero exit and on oversized output", async () => {
    await expect(runBinary(process.execPath, ["-e", "process.exit(3)"])).rejects.toThrowError(/status 3/);
    await expect(
      runBinary(process.execPath, ["-e", "process.stdout.write('x'.repeat(5000))"], { maxOutputBytes: 100 })
    ).rejects.toThrowError(/file-too-large/);
  });
});
