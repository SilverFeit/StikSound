import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sniffImageHeader, sniffVideoContainer } from "@stiksound/media-web";
import { MyInstantsProvider, type FetchLike } from "@stiksound/providers";
import { runCli, type RunCliOptions } from "../src/cli";
import { FakeCliEngine, makeTinyMp4, makeTinyPng, makeToneWav } from "./support";

const fixturesDir = path.resolve(__dirname, "../../../fixtures/myinstants");

interface CliCapture {
  code: number;
  stdout: string;
  stderr: string;
}

let workDir: string;
let outDir: string;
let pngPath: string;
let mp4Path: string;
let wavPath: string;
let lateWavPath: string;
let engine: FakeCliEngine;
let copied: string[];
let fetched: string[];

async function invoke(argv: string[], extra: Partial<RunCliOptions> = {}): Promise<CliCapture> {
  const out: string[] = [];
  const err: string[] = [];
  const html = await readFile(path.join(fixturesDir, "instant-page.html"));
  const fakeMp3 = new Uint8Array([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xfb, 0x90, 0x00, 0x00, 0x00]); // ID3 + MP3 frame header
  const fakeFetch: FetchLike = async (input) => {
    const url = String(input);
    fetched.push(url);
    return url.includes("/media/sounds/") ? new Response(Buffer.from(fakeMp3)) : new Response(Buffer.from(html));
  };

  const code = await runCli(argv, {
    engine,
    providers: [new MyInstantsProvider(fakeFetch)],
    outputDir: outDir,
    cwd: workDir,
    copyToClipboard: async (filePath) => {
      copied.push(filePath);
      return true;
    },
    io: {
      stdout: (line) => out.push(line),
      stderr: (line) => err.push(line)
    },
    ...extra
  });
  return { code, stdout: out.join("\n"), stderr: err.join("\n") };
}

describe("apps/cli headless commands (no FFmpeg required)", () => {
  beforeAll(async () => {
    workDir = await mkdtemp(path.join(os.tmpdir(), "stiksound-cli-test-"));
    outDir = path.join(workDir, "out");
    pngPath = path.join(workDir, "Cat Meme.png");
    mp4Path = path.join(workDir, "clip.mp4");
    wavPath = path.join(workDir, "tone.wav");
    lateWavPath = path.join(workDir, "late.wav");
    engine = new FakeCliEngine();
    copied = [];
    fetched = [];

    await Promise.all([
      writeFile(pngPath, makeTinyPng(900, 600, true)),
      writeFile(mp4Path, makeTinyMp4()),
      writeFile(wavPath, makeToneWav(3000)),
      writeFile(lateWavPath, makeToneWav(14000, { silenceMs: 9000 }))
    ]);
  });

  afterAll(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("shows help and version", async () => {
    const help = await invoke(["--help"]);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("stiksound <command>");

    const createHelp = await invoke(["create", "--help"]);
    expect(createHelp.code).toBe(0);
    expect(createHelp.stdout).toContain("--matte");

    const ver = await invoke(["--version"]);
    expect(ver.code).toBe(0);
    expect(ver.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("probes images, videos (with and without sound) and audio including truncated long audio", async () => {
    // Relative path works in CLI mode
    const img = await invoke(["probe", "Cat Meme.png", "--json"]);
    expect(img.code).toBe(0);
    expect(JSON.parse(img.stdout)).toMatchObject({
      kind: "image",
      format: "png",
      width: 900,
      height: 600,
      has_alpha: true,
      output_px: "512x512",
      needs_crop: true,
      static_webp_supported: true
    });

    // Save a WebP framing preview via --preview
    const previewFile = path.join(workDir, "preview.webp");
    const withPreview = await invoke(["probe", pngPath, "--crop-x", "0", "--preview", previewFile, "--json"]);
    expect(withPreview.code).toBe(0);
    expect(JSON.parse(withPreview.stdout).preview_path).toBe(previewFile);
    expect(sniffImageHeader(new Uint8Array(await readFile(previewFile)))).toMatchObject({
      format: "webp",
      width: 512,
      height: 512
    });

    // Video with and without audio (independent of localized labels)
    engine.videoHasSound = true;
    const vidSound = await invoke(["probe", mp4Path, "--json"]);
    expect(JSON.parse(vidSound.stdout)).toMatchObject({ kind: "video", has_sound: true });

    engine.videoHasSound = false;
    const vidMute = await invoke(["probe", mp4Path, "--json"]);
    expect(JSON.parse(vidMute.stdout)).toMatchObject({ kind: "video", has_sound: false });
    engine.videoHasSound = true;

    // Audio with leading silence & loudest window
    const aud = await invoke(["probe", lateWavPath, "--json"]);
    expect(aud.code).toBe(0);
    const audJson = JSON.parse(aud.stdout);
    expect(audJson).toMatchObject({ kind: "audio", format: "wav", within_import_limit: true });
    expect(audJson.leading_silence_ms).toBeGreaterThanOrEqual(8900);
    expect(audJson.loudest_window["5s"].start_ms).toBeGreaterThanOrEqual(8500);

    // Long audio exceeding decode cap reports true source duration & analysis_truncated
    engine.simulatedTruncatedDurationMs = 600_000;
    const longAud = await invoke(["probe", wavPath, "--json"]);
    engine.simulatedTruncatedDurationMs = null;
    expect(longAud.code).toBe(0);
    expect(JSON.parse(longAud.stdout)).toMatchObject({
      kind: "audio",
      duration_ms: 600_000,
      analysis_truncated: true,
      within_import_limit: false
    });
  });

  it("creates MP4, WebM alpha, sound-bundle and standard-webp with relative paths and human/JSON output", async () => {
    const mp4 = await invoke(["create", "Cat Meme.png", "-a", "tone.wav", "--json"]);
    expect(mp4.code).toBe(0);
    const mp4Data = JSON.parse(mp4.stdout);
    expect(mp4Data).toMatchObject({
      profile: "video-mp4",
      mime_type: "video/mp4",
      output_px: "512x512"
    });
    expect(mp4Data.output_path).toBe(path.join(outDir, "cat-meme-10s.mp4"));
    expect(mp4Data.note).toContain("not a WhatsApp sticker");
    expect(sniffVideoContainer(new Uint8Array(await readFile(mp4Data.output_path)))).toBe("mp4");

    // Second run auto-suffixes without overwriting
    const mp4Second = await invoke(["create", "Cat Meme.png", "-a", "tone.wav", "--json"]);
    expect(JSON.parse(mp4Second.stdout).output_path).toBe(path.join(outDir, "cat-meme-10s-2.mp4"));

    // Explicit -o file refuses overwrite without --force and succeeds with --force
    const exactFile = path.join(workDir, "custom.mp4");
    const firstExact = await invoke([
      "create", pngPath, "-a", lateWavPath,
      "--start", "0:09", "--end", "12.5s", "-d", "5",
      "--volume", "0.5", "--crop-x", "0.25", "--matte", "#00ff00",
      "-o", exactFile, "--copy", "--json"
    ]);
    expect(firstExact.code).toBe(0);
    const firstExactJson = JSON.parse(firstExact.stdout);
    expect(firstExactJson.output_path).toBe(exactFile);
    expect(firstExactJson.audio.trim).toEqual({ start_ms: 9000, end_ms: 12500 });
    expect(firstExactJson.audio.volume).toBe(0.5);
    expect(firstExactJson.copied_to_clipboard).toBe(true);
    expect(copied).toContain(exactFile);
    expect(engine.lastVideoRequest?.matteColor).toBe("#00FF00");
    expect(engine.lastVideoRequest?.cropX).toBe(0.25);

    const collide = await invoke(["create", pngPath, "-a", wavPath, "-o", exactFile, "--json"]);
    expect(collide.code).toBe(2);
    expect(collide.stderr).toContain("already exists");

    const forced = await invoke(["create", pngPath, "-a", wavPath, "-o", exactFile, "--force", "--json"]);
    expect(forced.code).toBe(0);

    // Static WebP without audio
    const webpPath = path.join(workDir, "cat.webp");
    const webp = await invoke(["create", pngPath, "--profile", "standard-webp", "-o", webpPath]);
    expect(webp.code).toBe(0);
    expect(webp.stdout).toContain("standard-webp");
    expect(sniffImageHeader(new Uint8Array(await readFile(webpPath)))).toMatchObject({
      format: "webp",
      width: 512,
      height: 512
    });
  });

  it("supports --trim loudest, MyInstants URL, --save-project, probe project, and export", async () => {
    const loud = await invoke(["create", pngPath, "-a", lateWavPath, "--trim", "loudest", "-d", "5", "--json"]);
    expect(loud.code).toBe(0);
    const loudTrim = JSON.parse(loud.stdout).audio.trim;
    expect(loudTrim.end_ms - loudTrim.start_ms).toBe(5000);
    expect(loudTrim.start_ms).toBeGreaterThanOrEqual(8500);

    const projPath = path.join(workDir, "saved.stiksound.zip");
    const myinstants = await invoke([
      "create", pngPath,
      "-u", "https://www.myinstants.com/en/instant/airhorn-classic/?utm=cli",
      "--profile", "sound-bundle",
      "--save-project", projPath,
      "--json"
    ]);
    expect(myinstants.code).toBe(0);
    const myData = JSON.parse(myinstants.stdout);
    expect(myData.project_path).toBe(projPath);
    expect(myData.audio).toMatchObject({
      source: "myinstants",
      source_name: "Airhorn Classic"
    });
    expect(fetched).toEqual([
      "https://www.myinstants.com/en/instant/airhorn-classic/",
      "https://www.myinstants.com/media/sounds/airhorn-fixture.mp3"
    ]);

    // Probe saved .stiksound.zip project
    const probedProj = await invoke(["probe", projPath, "--json"]);
    expect(probedProj.code).toBe(0);
    expect(JSON.parse(probedProj.stdout)).toMatchObject({
      kind: "project",
      profile: "sound-bundle",
      audio: { source: "myinstants", source_name: "Airhorn Classic" }
    });

    // Re-export saved project to video-webm-alpha with an overridden trim
    const reExport = await invoke([
      "export", projPath,
      "--profile", "video-webm-alpha",
      "--start", "0.5s", "--end", "2.5s",
      "-o", path.join(workDir, "reexport.webm"),
      "--json"
    ]);
    expect(reExport.code).toBe(0);
    const reData = JSON.parse(reExport.stdout);
    expect(reData).toMatchObject({
      profile: "video-webm-alpha",
      mime_type: "video/webm",
      audio: { trim: { start_ms: 500, end_ms: 2500 } }
    });
  });

  it("prints MCP config snippets and delegates `stiksound mcp` cleanly", async () => {
    const cfg = await invoke(["mcp", "--print-config", "--output-dir", outDir], {
      execPath: "/opt/stiksound/cli.mjs"
    });
    expect(cfg.code).toBe(0);
    expect(cfg.stdout).toContain("claude mcp add stiksound");
    expect(cfg.stdout).toContain("/opt/stiksound/cli.mjs");
    expect(cfg.stdout).toContain(outDir);

    let capturedDir: string | undefined;
    const started = await invoke(["mcp", "--output-dir", outDir], {
      startMcp: async (opts) => {
        capturedDir = opts.outputDir;
      }
    });
    expect(started.code).toBe(0);
    expect(capturedDir).toBe(outDir);
  });

  it("runs doctor and reports missing ffmpeg gracefully with exit code 1", async () => {
    const missingEngine = new FakeCliEngine({
      ffmpeg: "/nonexistent/stiksound-ffmpeg",
      ffprobe: "/nonexistent/stiksound-ffprobe"
    });
    const doc = await invoke(["doctor", "--json"], { engine: missingEngine });
    expect(doc.code).toBe(1);
    const parsed = JSON.parse(doc.stdout);
    expect(parsed.ok).toBe(false);
    expect(parsed.ffmpeg.available).toBe(false);
    expect(parsed.webp_wasm.available).toBe(true);
    expect(parsed.install_hint.length).toBeGreaterThan(0);
  });

  it("returns exit code 2 for CLI input errors and exit code 1 for domain errors", async () => {
    expect((await invoke(["unknown-cmd"])).code).toBe(2);
    expect((await invoke(["create", pngPath])).code).toBe(2); // missing audio
    expect((await invoke(["create", pngPath, "-a", wavPath, "-u", "https://www.myinstants.com/en/instant/a/"])).code).toBe(2);

    const badHost = await invoke(["create", pngPath, "-u", "https://evil.example/media/sounds/a.mp3", "--json"]);
    expect(badHost.code).toBe(1);
    expect(JSON.parse(badHost.stderr).error.code).toBe("url-rejected");
  });
});
