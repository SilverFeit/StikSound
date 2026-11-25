import { describe, expect, it } from "vitest";
import {
  buildVideoArgs,
  matteToFfmpegColor,
  parseEncoderList,
  parseProbeJson,
  pickH264Encoder,
  pickOpusEncoder,
  resolveBinaries,
  runBinary
} from "../src/engine";

const ENCODERS_SAMPLE = [
  "Encoders:",
  " V..... = Video",
  " A..... = Audio",
  " ------",
  " V....D libx264              libx264 H.264 / AVC",
  " V....D h264_videotoolbox    VideoToolbox H.264",
  " V....D libvpx-vp9           libvpx VP9",
  " A....D aac                  AAC",
  " A..X.D opus                 Opus",
  " A....D libopus              libopus Opus"
].join("\r\n");

describe("apps/cli ffmpeg helpers (cross-platform)", () => {
  it("parses encoder names across CRLF and LF outputs", () => {
    const encoders = parseEncoderList(ENCODERS_SAMPLE);
    expect([...encoders].sort()).toEqual(["aac", "h264_videotoolbox", "libopus", "libvpx-vp9", "libx264", "opus"]);
  });

  it("prefers libx264 and libopus, then falls back", () => {
    expect(pickH264Encoder(new Set(["h264_videotoolbox", "libx264"]))).toBe("libx264");
    expect(pickH264Encoder(new Set(["h264_mf"]))).toBe("h264_mf");
    expect(pickH264Encoder(new Set(["libvpx-vp9"]))).toBeNull();
    expect(pickOpusEncoder(new Set(["opus", "libopus"]))).toBe("libopus");
    expect(pickOpusEncoder(new Set(["opus"]))).toBe("opus");
    expect(pickOpusEncoder(new Set())).toBeNull();
  });

  it("resolves binaries on POSIX and Windows paths", () => {
    expect(resolveBinaries({})).toEqual({ ffmpeg: "ffmpeg", ffprobe: "ffprobe" });
    expect(resolveBinaries({ STIKSOUND_FFMPEG: "/opt/ff/bin/ffmpeg" })).toEqual({
      ffmpeg: "/opt/ff/bin/ffmpeg",
      ffprobe: "/opt/ff/bin/ffprobe"
    });
    expect(resolveBinaries({ STIKSOUND_FFMPEG: "C:\\ffmpeg\\bin\\ffmpeg.exe" })).toEqual({
      ffmpeg: "C:\\ffmpeg\\bin\\ffmpeg.exe",
      ffprobe: "C:\\ffmpeg\\bin\\ffprobe.exe"
    });
    expect(resolveBinaries({ STIKSOUND_FFMPEG: "/a/ffmpeg", STIKSOUND_FFPROBE: "/b/ffprobe" })).toEqual({
      ffmpeg: "/a/ffmpeg",
      ffprobe: "/b/ffprobe"
    });
  });

  it("parses ffprobe JSON including display rotation", () => {
    const parsed = parseProbeJson(
      JSON.stringify({
        format: { duration: "4.25" },
        streams: [
          { codec_type: "video", codec_name: "h264", width: 1080, height: 1920, side_data_list: [{ rotation: -90 }] },
          { codec_type: "audio", codec_name: "aac", sample_rate: "48000", channels: 2, duration: "4.2" }
        ]
      })
    );
    expect(parsed.durationMs).toBe(4250);
    expect(parsed.streams[0]).toMatchObject({ codecType: "video", rotation: 270, width: 1080, height: 1920 });
    expect(parsed.streams[1]).toMatchObject({ codecType: "audio", sampleRate: 48000, channels: 2, durationMs: 4200 });
  });

  it("validates matte colors and constructs safe ffmpeg args", () => {
    expect(matteToFfmpegColor("#00ff7f")).toBe("0x00FF7F");
    expect(() => matteToFfmpegColor("red")).toThrowError(/Invalid matte color/);
    expect(() => matteToFfmpegColor("#FFFFFF;rm -rf")).toThrowError(/Invalid matte color/);

    const args = buildVideoArgs({
      motion: "still",
      stickerPath: "/tmp/s.png",
      audioPath: "/tmp/a.wav",
      outputPath: "/tmp/o.mp4",
      sourceWidth: 800,
      sourceHeight: 600,
      cropX: 0.5,
      cropY: 0.5,
      clipOffsetMs: 0,
      durationMs: 2500,
      matteColor: "#00FF7F",
      container: "mp4",
      videoEncoder: "libx264",
      audioEncoder: "aac"
    });
    const graph = args[args.indexOf("-filter_complex") + 1]!;
    expect(graph).toContain("color=c=0x00FF7F:s=512x512:r=25[bg]");
    expect(graph).toContain("crop=600:600:100:0,scale=512:512:flags=lanczos");
  });

  it("reports missing binary as unsupported-codec and passes stdin/env cleanly", async () => {
    await expect(runBinary("stiksound-no-such-binary", ["-version"])).rejects.toThrowError(/unsupported-codec/);

    const res = await runBinary(
      process.execPath,
      ["-e", "process.stdout.write(process.env.TEST_VAL || '')"],
      { env: { TEST_VAL: "hello-cli" } }
    );
    expect(new TextDecoder().decode(res.stdout)).toBe("hello-cli");

    await expect(runBinary(process.execPath, ["-e", "process.exit(3)"])).rejects.toThrowError(/status 3/);
    await expect(
      runBinary(process.execPath, ["-e", "process.stdout.write('x'.repeat(5000))"], { maxOutputBytes: 100 })
    ).rejects.toThrowError(/file-too-large/);
  });
});
