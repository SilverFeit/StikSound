import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sniffImageHeader } from "@stiksound/media-web";
import { MyInstantsProvider, type FetchLike } from "@stiksound/providers";
import { createMcpServer } from "../src/mcp/server";
import { FakeCliEngine, makeTinyPng, makeToneWav } from "./support";

const fixturesDir = path.resolve(__dirname, "../../../fixtures/myinstants");

interface ToolReply {
  isError: boolean;
  json: Record<string, any>;
  image: { data: string; mimeType: string } | undefined;
}

let workDir: string;
let outDir: string;
let pngPath: string;
let wavPath: string;
let client: Client;

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

describe("apps/cli integrated MCP server (`stiksound mcp`)", () => {
  beforeAll(async () => {
    workDir = await mkdtemp(path.join(os.tmpdir(), "stiksound-cli-mcp-"));
    outDir = path.join(workDir, "out");
    pngPath = path.join(workDir, "cat.png");
    wavPath = path.join(workDir, "tone.wav");
    await Promise.all([
      writeFile(pngPath, makeTinyPng(800, 600, true)),
      writeFile(wavPath, makeToneWav(3000))
    ]);

    const html = await readFile(path.join(fixturesDir, "instant-page.html"));
    const fakeMp3 = new Uint8Array([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xfb, 0x90, 0x00, 0x00, 0x00]);
    const fakeFetch: FetchLike = async (input) =>
      String(input).includes("/media/sounds/") ? new Response(Buffer.from(fakeMp3)) : new Response(Buffer.from(html));

    const server = createMcpServer({
      engine: new FakeCliEngine(),
      providers: [new MyInstantsProvider(fakeFetch)],
      outputDir: outDir,
      copyToClipboard: async () => true
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-client", version: "0.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterAll(async () => {
    await client?.close();
    await rm(workDir, { recursive: true, force: true });
  });

  it("advertises the three tools with schemas and instructions", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["create_sound_sticker", "export_project", "probe_media"]);
    expect(client.getInstructions()).toContain("absolute");
  });

  it("requires absolute paths in MCP mode (rejects relative paths)", async () => {
    const reply = await call("probe_media", { path: "cat.png" });
    expect(reply.isError).toBe(true);
    expect(reply.json.error).toMatchObject({ code: "invalid-input" });
    expect(reply.json.error.message).toContain("absolute path");
  });

  it("probes, creates with MyInstants + save_project, and re-exports via MCP", async () => {
    const probed = await call("probe_media", { path: pngPath });
    expect(probed.isError).toBe(false);
    expect(probed.json).toMatchObject({ kind: "image", width: 800, height: 600, output_px: "512x512" });
    expect(probed.image?.mimeType).toBe("image/webp");
    expect(sniffImageHeader(new Uint8Array(Buffer.from(probed.image!.data, "base64")))).toMatchObject({
      format: "webp",
      width: 512,
      height: 512
    });

    const created = await call("create_sound_sticker", {
      image_path: pngPath,
      myinstants_url: "https://www.myinstants.com/en/instant/airhorn-classic/",
      profile: "sound-bundle",
      save_project: true
    });
    expect(created.isError).toBe(false);
    expect(created.json.audio.source).toBe("myinstants");
    expect(created.json.project_path).toMatch(/\.stiksound\.zip$/);

    const exported = await call("export_project", {
      project_path: created.json.project_path,
      profile: "standard-webp"
    });
    expect(exported.isError).toBe(false);
    expect(exported.json.profile).toBe("standard-webp");
    expect(exported.json.audio).toBeUndefined();
  });
});
