import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sniffImageHeader, sniffVideoContainer } from "@stiksound/media-web";
import { MyInstantsProvider, type FetchLike } from "@stiksound/providers";
import { createServer } from "../src/server";
import { gifFixture, hasFfmpeg, lateToneMp3, pngFixture, toneWav } from "./support";

interface ToolReply {
  isError: boolean;
  json: Record<string, any>;
  image: { data: string; mimeType: string } | undefined;
}

const fixturesDir = path.resolve(__dirname, "../../../fixtures/myinstants");

let workDir: string;
let outDir: string;
let client: Client;
const copied: string[] = [];
const fetched: string[] = [];
const paths: Record<"png" | "gif" | "wav" | "mp3", string> = { png: "", gif: "", wav: "", mp3: "" };

async function call(name: string, args: Record<string, unknown>): Promise<ToolReply> {
  const result = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  };
  const text = result.content.find((item) => item.type === "text")?.text ?? "{}";
  const image = result.content.find((item) => item.type === "image");
  return {
    isError: result.isError === true,
    json: JSON.parse(text) as Record<string, any>,
    image: image ? { data: image.data!, mimeType: image.mimeType! } : undefined
  };
}

describe.skipIf(!hasFfmpeg)("apps/mcp tools over the MCP protocol", () => {
  beforeAll(async () => {
    workDir = await mkdtemp(path.join(os.tmpdir(), "stiksound-mcp-tools-"));
    outDir = path.join(workDir, "out");
    paths.png = path.join(workDir, "Cat Meme.png");
    paths.gif = path.join(workDir, "spin.gif");
    paths.wav = path.join(workDir, "tone.wav");
    paths.mp3 = path.join(workDir, "late.mp3");
    const mp3 = await lateToneMp3(20, 14);
    await Promise.all([
      writeFile(paths.png, await pngFixture(900, 600)),
      writeFile(paths.gif, await gifFixture(2)),
      writeFile(paths.wav, await toneWav(3)),
      writeFile(paths.mp3, mp3)
    ]);

    // MyInstants stand-in: the saved HTML fixture for the page, the generated MP3 for the media URL.
    const html = await readFile(path.join(fixturesDir, "instant-page.html"));
    const fakeFetch: FetchLike = async (input) => {
      const url = String(input);
      fetched.push(url);
      return url.includes("/media/sounds/") ? new Response(Buffer.from(mp3)) : new Response(Buffer.from(html));
    };

    const server = createServer({
      providers: [new MyInstantsProvider(fakeFetch)],
      outputDir: outDir,
      copyToClipboard: async (filePath) => {
        copied.push(filePath);
        return true;
      }
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-client", version: "0.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  }, 60_000);

  afterAll(async () => {
    await client?.close();
    await rm(workDir, { recursive: true, force: true });
  });

  it("advertises three tools with schemas and the server instructions", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(["create_sound_sticker", "export_project", "probe_media"]);
    const create = tools.find((tool) => tool.name === "create_sound_sticker")!;
    expect(create.inputSchema.required).toEqual(["image_path"]);
    expect(tools.find((tool) => tool.name === "probe_media")!.annotations?.readOnlyHint).toBe(true);
    expect(client.getInstructions()).toContain("absolute");
  });

  it("creates the default MP4 from a PNG and a WAV", async () => {
    const reply = await call("create_sound_sticker", { image_path: paths.png, audio_path: paths.wav });
    expect(reply.isError).toBe(false);
    expect(reply.json).toMatchObject({
      profile: "video-mp4",
      mime_type: "video/mp4",
      output_px: "512x512",
      sticker: { format: "png", width: 900, height: 600 },
      audio: { source: "local", trim: { start_ms: 0, end_ms: 3000 }, volume: 1 }
    });
    expect(reply.json.output_path).toBe(path.join(outDir, "cat-meme-10s.mp4"));
    expect(reply.json.note).toContain("not a WhatsApp sticker");
    expect(sniffVideoContainer(new Uint8Array(await readFile(reply.json.output_path)))).toBe("mp4");
    expect(reply.image?.mimeType).toBe("image/webp");
    expect(sniffImageHeader(new Uint8Array(Buffer.from(reply.image!.data, "base64")))).toMatchObject({ width: 512, height: 512 });
  }, 60_000);

  it("never overwrites: a second identical call gets a new file name", async () => {
    const reply = await call("create_sound_sticker", { image_path: paths.png, audio_path: paths.wav });
    expect(path.basename(reply.json.output_path)).toBe("cat-meme-10s-2.mp4");
  }, 60_000);

  it("applies an explicit trim, volume, crop, color, name and the 5 s preset", async () => {
    const reply = await call("create_sound_sticker", {
      image_path: paths.png,
      audio_path: paths.mp3,
      start_ms: 14_000,
      end_ms: 17_500,
      max_duration_s: 5,
      volume: 0.5,
      crop_x: 0,
      background_color: "#00ff00",
      name: "Late Tone",
      copy_to_clipboard: true
    });
    expect(reply.isError).toBe(false);
    expect(path.basename(reply.json.output_path)).toBe("late-tone-5s.mp4");
    expect(reply.json.audio).toMatchObject({ trim: { start_ms: 14_000, end_ms: 17_500 }, volume: 0.5 });
    expect(reply.json.sticker.crop_x).toBe(0);
    expect(Math.abs(reply.json.duration_ms - 3500)).toBeLessThanOrEqual(50);
    expect(reply.json.copied_to_clipboard).toBe(true);
    expect(copied).toContain(reply.json.output_path);
  }, 60_000);

  it('picks the loudest window with trim: "loudest"', async () => {
    const reply = await call("create_sound_sticker", {
      image_path: paths.png,
      audio_path: paths.mp3,
      trim: "loudest",
      max_duration_s: 5,
      name: "loud"
    });
    expect(reply.isError).toBe(false);
    const { start_ms, end_ms } = reply.json.audio.trim;
    expect(end_ms - start_ms).toBe(5000);
    expect(start_ms).toBeGreaterThanOrEqual(13_500);
  }, 60_000);

  it("downloads a MyInstants sound through the provider and records its source", async () => {
    const reply = await call("create_sound_sticker", {
      image_path: paths.png,
      myinstants_url: "https://www.myinstants.com/en/instant/airhorn-classic/?utm=x",
      profile: "sound-bundle",
      save_project: true
    });
    expect(reply.isError).toBe(false);
    expect(fetched).toEqual([
      "https://www.myinstants.com/en/instant/airhorn-classic/",
      "https://www.myinstants.com/media/sounds/airhorn-fixture.mp3"
    ]);
    expect(reply.json.audio).toMatchObject({
      source: "myinstants",
      source_name: "Airhorn Classic",
      page_url: "https://www.myinstants.com/en/instant/airhorn-classic/"
    });
    expect(path.basename(reply.json.output_path)).toBe("cat-meme-stiksound.zip");
    expect(path.basename(reply.json.project_path)).toBe("cat-meme.stiksound.zip");
    expect(reply.json.note).toContain("without sound");
  }, 60_000);

  it("re-exports a saved project with another profile", async () => {
    const reply = await call("export_project", {
      project_path: path.join(outDir, "cat-meme.stiksound.zip"),
      profile: "standard-webp",
      output_dir: path.join(workDir, "second")
    });
    expect(reply.isError).toBe(false);
    expect(reply.json.output_path).toBe(path.join(workDir, "second", "cat-meme-sticker.webp"));
    expect(reply.json.audio).toBeUndefined();
    const webp = new Uint8Array(await readFile(reply.json.output_path));
    expect(webp.byteLength).toBeLessThanOrEqual(102_400);
    expect(sniffImageHeader(webp)).toMatchObject({ format: "webp", width: 512, height: 512 });
  }, 60_000);

  it("probes audio with level facts and the loudest windows", async () => {
    const reply = await call("probe_media", { path: paths.mp3 });
    expect(reply.isError).toBe(false);
    expect(reply.json).toMatchObject({ kind: "audio", format: "mp3", within_import_limit: true });
    expect(Math.abs(reply.json.duration_ms - 20_000)).toBeLessThanOrEqual(100);
    expect(Math.abs(reply.json.leading_silence_ms - 14_000)).toBeLessThanOrEqual(100);
    expect(reply.json.loudest_window["5s"].start_ms).toBeGreaterThanOrEqual(13_500);
    expect(reply.json.loudest_window["10s"].end_ms - reply.json.loudest_window["10s"].start_ms).toBe(10_000);
    expect(reply.image).toBeUndefined();
  }, 60_000);

  it("probes images and GIFs and returns a preview without writing files", async () => {
    const before = (await readdir(outDir)).length;
    const png = await call("probe_media", { path: paths.png, crop_x: 1 });
    expect(png.json).toMatchObject({
      kind: "image",
      format: "png",
      width: 900,
      height: 600,
      output_px: "512x512",
      needs_crop: true,
      static_webp_supported: true
    });
    expect(png.image?.mimeType).toBe("image/webp");

    const gif = await call("probe_media", { path: paths.gif });
    expect(gif.json).toMatchObject({ kind: "image", format: "gif", animated: true, static_webp_supported: false });
    expect(Math.abs(gif.json.duration_ms - 2000)).toBeLessThanOrEqual(100);
    expect((await readdir(outDir)).length).toBe(before);
  }, 60_000);

  it("reports bad input as structured tool errors", async () => {
    const noAudio = await call("create_sound_sticker", { image_path: paths.png });
    expect(noAudio.isError).toBe(true);
    expect(noAudio.json.error).toMatchObject({ code: "invalid-input" });
    expect(noAudio.json.error.message).toContain("audio_path or myinstants_url");

    const relative = await call("create_sound_sticker", { image_path: "cat.png", audio_path: paths.wav });
    expect(relative.json.error.message).toContain("absolute path");

    const both = await call("create_sound_sticker", {
      image_path: paths.png,
      audio_path: paths.wav,
      myinstants_url: "https://www.myinstants.com/en/instant/a/"
    });
    expect(both.json.error.message).toContain("not both");

    const badTrim = await call("create_sound_sticker", { image_path: paths.png, audio_path: paths.wav, start_ms: 2000, end_ms: 9000 });
    expect(badTrim.json.error.code).toBe("trim-out-of-range");

    const badHost = await call("create_sound_sticker", { image_path: paths.png, myinstants_url: "https://evil.example/media/sounds/a.mp3" });
    expect(badHost.json.error.code).toBe("url-rejected");

    const notMedia = await call("probe_media", { path: path.join(fixturesDir, "instant-page.html") });
    expect(notMedia.isError).toBe(true);
    expect(notMedia.json.error.code).toBe("unsupported-audio");

    const animatedWebp = await call("create_sound_sticker", { image_path: paths.gif, profile: "standard-webp" });
    expect(animatedWebp.json.error.code).toBe("unsupported-image");
  }, 60_000);

  it("rejects arguments that do not match the schema", async () => {
    const result = (await client.callTool({
      name: "create_sound_sticker",
      arguments: { image_path: paths.png, audio_path: paths.wav, max_duration_s: 7 }
    })) as { isError?: boolean; content: Array<{ text?: string }> };
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("max_duration_s");
  });
});

describe("apps/mcp server without media work", () => {
  it("starts and lists tools even when FFmpeg is missing", async () => {
    vi.stubEnv("STIKSOUND_FFMPEG", "/nonexistent/ffmpeg");
    try {
      const server = createServer({ outputDir: os.tmpdir() });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const local = new Client({ name: "test-client", version: "0.0.0" });
      await Promise.all([server.connect(serverTransport), local.connect(clientTransport)]);
      expect((await local.listTools()).tools).toHaveLength(3);

      const dir = await mkdtemp(path.join(os.tmpdir(), "stiksound-mcp-noff-"));
      const wav = path.join(dir, "a.wav");
      // A minimal RIFF/WAVE header is enough to reach the decoder.
      const header = Buffer.alloc(44 + 48000);
      header.write("RIFF", 0);
      header.writeUInt32LE(36 + 48000, 4);
      header.write("WAVEfmt ", 8);
      header.writeUInt32LE(16, 16);
      header.writeUInt16LE(1, 20);
      header.writeUInt16LE(1, 22);
      header.writeUInt32LE(48000, 24);
      header.writeUInt32LE(96000, 28);
      header.writeUInt16LE(2, 32);
      header.writeUInt16LE(16, 34);
      header.write("data", 36);
      header.writeUInt32LE(48000, 40);
      await writeFile(wav, header);

      const result = (await local.callTool({ name: "probe_media", arguments: { path: wav } })) as {
        isError?: boolean;
        content: Array<{ text?: string }>;
      };
      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain("unsupported-codec");
      expect(result.content[0]!.text).toContain("Install FFmpeg");
      await local.close();
      await rm(dir, { recursive: true, force: true });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
