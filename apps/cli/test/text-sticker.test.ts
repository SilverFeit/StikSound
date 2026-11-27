import { describe, expect, it } from "vitest";
import { sniffImageHeader } from "@stiksound/media-web";
import { buildTextStickerSvg, renderTextStickerPng } from "../src/engine/text-sticker";

describe("apps/cli text-to-sticker renderer", () => {
  it("renders a valid 512x512 RGBA PNG with transparency in meme style by default", async () => {
    const png = await renderTextStickerPng({ text: "Literally me" });
    expect(sniffImageHeader(png)).toMatchObject({
      format: "png",
      width: 512,
      height: 512,
      has_alpha: true,
      animated: false
    });
    expect(png.byteLength).toBeGreaterThan(500);
  });

  it("supports card and minimal styles with custom colors and multi-line wrapping", async () => {
    const cardPng = await renderTextStickerPng({
      text: "Cuando compila a la primera\npero nadie te cree",
      style: "card",
      backgroundColor: "#1E293B",
      textColor: "#FACC15"
    });
    expect(sniffImageHeader(cardPng)).toMatchObject({
      format: "png",
      width: 512,
      height: 512
    });

    const minimalPng = await renderTextStickerPng({
      text: "OK",
      style: "minimal",
      backgroundColor: "#FFFFFF"
    });
    expect(sniffImageHeader(minimalPng)).toMatchObject({
      format: "png",
      width: 512,
      height: 512
    });
  });

  it("escapes XML special characters and strips control characters safely", () => {
    const svg = buildTextStickerSvg({
      text: `<script>alert("x")</script> & 'hi'\u0000`,
      style: "minimal",
      backgroundColor: "#000000"
    });
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
    expect(svg).toContain("&amp;");
    expect(svg).toContain("&apos;hi&apos;");
  });

  it("wraps long unbroken words and near-limit text without overflowing, and omits rect when transparent", async () => {
    const longWord = "SUPERLONGUNBROKENWORDWITHOUTSPACES1234567890";
    const svg = buildTextStickerSvg({
      text: longWord,
      style: "meme",
      backgroundColor: "transparent"
    });
    expect(svg).not.toContain("<rect ");
    expect((svg.match(/<text /g) ?? []).length).toBeGreaterThanOrEqual(2);

    const png = await renderTextStickerPng({
      text: `${longWord} ${"texto ".repeat(22)}`.trim().slice(0, 200),
      style: "card",
      backgroundColor: "#0F172A"
    });
    expect(sniffImageHeader(png)).toMatchObject({ format: "png", width: 512, height: 512 });
  });

  it("rejects empty text, overly long text, bad colors, and unknown styles", async () => {
    await expect(renderTextStickerPng({ text: "   " })).rejects.toThrowError(/empty/);
    await expect(renderTextStickerPng({ text: "a".repeat(201) })).rejects.toThrowError(/200/);
    await expect(renderTextStickerPng({ text: "Hi", textColor: "red" })).rejects.toThrowError(/#RRGGBB/);
    await expect(renderTextStickerPng({ text: "Hi", backgroundColor: "rgb(0,0,0)" })).rejects.toThrowError(/#RRGGBB/);
    await expect(
      renderTextStickerPng({ text: "Hi", style: "comic" as "meme" })
    ).rejects.toThrowError(/Unsupported text style/);
  });
});
