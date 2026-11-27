import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { Resvg, initWasm } from "@resvg/resvg-wasm";
import { LIMITS, StikSoundError } from "@stiksound/core";
import { CliInputError } from "../errors";

export const TEXT_STICKER_STYLES = ["meme", "card", "minimal"] as const;
export type TextStickerStyle = (typeof TEXT_STICKER_STYLES)[number];

export const MAX_TEXT_STICKER_CHARS = 200;

export interface TextStickerOptions {
  text: string;
  textColor?: string;
  /** Hex `#RRGGBB` or `"transparent"`. */
  backgroundColor?: string;
  style?: TextStickerStyle;
}

const CANVAS_SIZE = LIMITS.STICKER_DIMENSION_PX;
const CARD_PADDING = 52;
const MEME_PADDING = 36;
const FONT_FAMILY = "Archivo Black";

let rendererReady: Promise<Uint8Array> | null = null;

export function isTextStickerStyle(value: string): value is TextStickerStyle {
  return (TEXT_STICKER_STYLES as readonly string[]).includes(value);
}

/**
 * Loads the resvg WebAssembly module and the bundled Archivo Black TTF font once per process.
 * Using WASM + a bundled permissive font ensures identical output across macOS, Windows, and Linux
 * without depending on system fonts or FFmpeg's optional libfreetype filter.
 */
export function ensureTextStickerRenderer(): Promise<Uint8Array> {
  if (!rendererReady) {
    rendererReady = (async () => {
      const require = createRequire(import.meta.url);
      const wasmPath = require.resolve("@resvg/resvg-wasm/index_bg.wasm");
      const fontPath = require.resolve("@expo-google-fonts/archivo-black/400Regular/ArchivoBlack_400Regular.ttf");
      const [wasmBytes, fontBytes] = await Promise.all([readFile(wasmPath), readFile(fontPath)]);
      const wasmModule = await WebAssembly.compile(wasmBytes);
      await initWasm(wasmModule);
      return new Uint8Array(fontBytes);
    })();
    rendererReady.catch(() => {
      rendererReady = null;
    });
  }
  return rendererReady;
}

function normalizeHexColor(raw: string, label: string): string {
  const trimmed = raw.trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    throw new CliInputError(`${label} must be a #RRGGBB hex value (got "${raw}").`);
  }
  return trimmed.toUpperCase();
}

function relativeLuminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function escapeXml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function sanitizeText(raw: string): string {
  // Strip control characters except newlines and tabs so SVG stays strictly well-formed.
  const cleaned = raw
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
  if (!cleaned) {
    throw new CliInputError("text must not be empty.");
  }
  if (cleaned.length > MAX_TEXT_STICKER_CHARS) {
    throw new CliInputError(`text must be at most ${MAX_TEXT_STICKER_CHARS} characters (got ${cleaned.length}).`);
  }
  return cleaned;
}

function estimateCharWidth(ch: string, fontSize: number): number {
  if (ch === " ") return fontSize * 0.34;
  if (/[ilI1|!.,:;'"`¡]/.test(ch)) return fontSize * 0.38;
  if (/[mwMW@#%&]/.test(ch)) return fontSize * 0.96;
  if (/[A-ZÁÉÍÓÚÑÜ]/.test(ch)) return fontSize * 0.76;
  return fontSize * 0.68;
}

function estimateTextWidth(text: string, fontSize: number): number {
  let width = 0;
  for (const ch of text) {
    width += estimateCharWidth(ch, fontSize);
  }
  return width;
}

function splitLongWord(word: string, maxWidth: number, fontSize: number): string[] {
  const parts: string[] = [];
  let current = "";
  let currentWidth = 0;
  for (const ch of word) {
    const chWidth = estimateCharWidth(ch, fontSize);
    if (current && currentWidth + chWidth > maxWidth) {
      parts.push(current);
      current = ch;
      currentWidth = chWidth;
    } else {
      current += ch;
      currentWidth += chWidth;
    }
  }
  if (current) parts.push(current);
  return parts;
}

function wrapText(text: string, maxWidth: number, fontSize: number): string[] {
  const paragraphs = text.split("\n");
  const lines: string[] = [];

  for (const rawParagraph of paragraphs) {
    const paragraph = rawParagraph.replace(/\s+/g, " ").trim();
    if (!paragraph) {
      if (lines.length > 0) lines.push("");
      continue;
    }
    const words = paragraph.split(" ");
    let currentLine = "";

    for (const word of words) {
      if (estimateTextWidth(word, fontSize) > maxWidth) {
        if (currentLine) {
          lines.push(currentLine);
          currentLine = "";
        }
        const chunks = splitLongWord(word, maxWidth, fontSize);
        lines.push(...chunks.slice(0, -1));
        currentLine = chunks[chunks.length - 1] ?? "";
        continue;
      }

      const candidate = currentLine ? `${currentLine} ${word}` : word;
      if (!currentLine || estimateTextWidth(candidate, fontSize) <= maxWidth) {
        currentLine = candidate;
      } else {
        lines.push(currentLine);
        currentLine = word;
      }
    }
    if (currentLine) {
      lines.push(currentLine);
    }
  }

  return lines.length > 0 ? lines : [text];
}

function layoutText(text: string, maxWidth: number, maxHeight: number): { lines: string[]; fontSize: number; lineHeight: number } {
  for (let fontSize = 112; fontSize >= 22; fontSize -= 4) {
    const lines = wrapText(text, maxWidth, fontSize);
    const lineHeight = Math.round(fontSize * 1.18);
    const totalHeight = lines.length * lineHeight;
    const widest = Math.max(...lines.map((line) => estimateTextWidth(line, fontSize)));
    if (widest <= maxWidth && totalHeight <= maxHeight) {
      return { lines, fontSize, lineHeight };
    }
  }
  const fontSize = 20;
  return {
    lines: wrapText(text, maxWidth, fontSize),
    fontSize,
    lineHeight: Math.round(fontSize * 1.18)
  };
}

/** Builds a self-contained 512x512 SVG document for the text sticker. */
export function buildTextStickerSvg(options: TextStickerOptions): string {
  const style: TextStickerStyle = options.style ?? "meme";
  if (!isTextStickerStyle(style)) {
    throw new CliInputError(`Unsupported text style "${String(style)}". Choose one of: ${TEXT_STICKER_STYLES.join(", ")}.`);
  }

  const rawText = sanitizeText(options.text);
  const displayText = style === "meme" ? rawText.toUpperCase() : rawText;

  const rawBg = options.backgroundColor?.trim();
  const isTransparent =
    rawBg?.toLowerCase() === "transparent" || (rawBg === undefined && style === "meme");
  const bgColor = isTransparent
    ? null
    : normalizeHexColor(rawBg ?? "#111827", "background_color");

  const defaultTextColor =
    bgColor && relativeLuminance(bgColor) > 0.55 ? "#111827" : "#FFFFFF";
  const textColor =
    options.textColor !== undefined
      ? normalizeHexColor(options.textColor, "text_color")
      : defaultTextColor;

  const padding = style === "card" ? CARD_PADDING : MEME_PADDING;
  const usable = CANVAS_SIZE - padding * 2;
  const { lines, fontSize, lineHeight } = layoutText(displayText, usable, usable);

  const totalHeight = lines.length * lineHeight;
  // Approximate baseline offset so the visual block sits vertically centered.
  const firstBaselineY = Math.round((CANVAS_SIZE - totalHeight) / 2 + fontSize * 0.86);

  const strokeColor = relativeLuminance(textColor) > 0.4 ? "#000000" : "#FFFFFF";
  const strokeWidth = style === "meme" ? Math.max(8, Math.round(fontSize * 0.18)) : 0;

  let backgroundMarkup = "";
  if (style === "card" && bgColor) {
    const borderColor = relativeLuminance(bgColor) > 0.5 ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.18)";
    backgroundMarkup = `<rect x="16" y="16" width="${CANVAS_SIZE - 32}" height="${CANVAS_SIZE - 32}" rx="56" fill="${bgColor}" stroke="${borderColor}" stroke-width="6"/>`;
  } else if (bgColor) {
    backgroundMarkup = `<rect x="0" y="0" width="${CANVAS_SIZE}" height="${CANVAS_SIZE}" fill="${bgColor}"/>`;
  }

  const textAttrs = [
    `x="${CANVAS_SIZE / 2}"`,
    `text-anchor="middle"`,
    `font-family="${FONT_FAMILY}"`,
    `font-size="${fontSize}"`,
    `fill="${textColor}"`,
    ...(strokeWidth > 0
      ? [
          `stroke="${strokeColor}"`,
          `stroke-width="${strokeWidth}"`,
          `stroke-linejoin="round"`,
          `paint-order="stroke fill"`
        ]
      : [])
  ].join(" ");

  const textNodes = lines
    .map((line, index) => {
      const y = firstBaselineY + index * lineHeight;
      return `<text ${textAttrs} y="${y}">${escapeXml(line || " ")}</text>`;
    })
    .join("");

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_SIZE}" height="${CANVAS_SIZE}" viewBox="0 0 ${CANVAS_SIZE} ${CANVAS_SIZE}">`,
    backgroundMarkup,
    textNodes,
    `</svg>`
  ].join("");
}

/** Renders a 512x512 PNG sticker from text using resvg-wasm and the bundled Archivo Black font. */
export async function renderTextStickerPng(options: TextStickerOptions): Promise<Uint8Array> {
  const svg = buildTextStickerSvg(options);
  const fontBuffer = await ensureTextStickerRenderer();

  let resvg: InstanceType<typeof Resvg> | null = null;
  let rendered: ReturnType<InstanceType<typeof Resvg>["render"]> | null = null;
  try {
    resvg = new Resvg(svg, {
      fitTo: { mode: "width", value: CANVAS_SIZE },
      font: {
        fontBuffers: [fontBuffer],
        defaultFontFamily: FONT_FAMILY,
        sansSerifFamily: FONT_FAMILY
      }
    });
    rendered = resvg.render();
    return new Uint8Array(rendered.asPng());
  } catch (err) {
    if (err instanceof CliInputError || err instanceof StikSoundError) throw err;
    throw new StikSoundError("encode-failed", `Text sticker renderer failed: ${(err as Error).message}`);
  } finally {
    rendered?.free();
    resvg?.free();
  }
}
