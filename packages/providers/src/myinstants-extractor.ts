import { StikSoundError } from "@stiksound/core";
import { validateMyInstantsUrl } from "./url-policy";

export interface ExtractedMyInstantsPage {
  title: string | null;
  media_url: string;
}

export interface MyInstantsSearchResult {
  title: string;
  page_url: string;
  media_url: string | null;
}

const PRIMARY_BUTTON_REGEX =
  /id=["']instant-page-button(?:-element)?["'][^>]*?(?:data-url|onclick)=["'][^"']*?(\/media\/sounds\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]+\.(?:mp3|wav|ogg|m4a))/i;
const DOWNLOAD_LINK_REGEX =
  /href=["'](\/media\/sounds\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]+\.(?:mp3|wav|ogg|m4a))["'][^>]*?download/i;
const MEDIA_PATH_REGEX =
  /(?:https:\/\/(?:www\.)?myinstants\.com)?(\/media\/sounds\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]+\.(?:mp3|wav|ogg|m4a))(?:\?[^"'\s<>)]*)?/i;
const PLAY_CALL_REGEX =
  /play\(\s*['"](\/media\/sounds\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]+\.(?:mp3|wav|ogg|m4a))['"]/i;
const INSTANT_CARD_SPLIT_REGEX = /<div\b[^>]*\bclass=["'][^"']*\binstant\b[^"']*["'][^>]*>/i;
const INSTANT_LINK_REGEX =
  /<a\b([^>]*\bclass=["'][^"']*\binstant-link\b[^"']*["'][^>]*)>([\s\S]*?)<\/a>/gi;
const HREF_ATTR_REGEX = /\bhref=["']([^"']+)["']/i;
const INSTANT_PATH_REGEX = /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?instant\/[^/?#]+\/?$/i;

const OG_TITLE_REGEX = /<meta\s+[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["'][^>]*>/i;
const OG_TITLE_REV_REGEX = /<meta\s+[^>]*content=["']([^"']+)["'][^>]*property=["']og:title["'][^>]*>/i;
const TITLE_TAG_REGEX = /<title[^>]*>([^<]+)<\/title>/i;

function decodeBasicEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function cleanTitle(rawTitle: string | null): string | null {
  if (!rawTitle) return null;
  const decoded = decodeBasicEntities(rawTitle.replace(/<[^>]+>/g, " "))
    .replace(/\s*[-|]\s*(?:Myinstants|Bot[oó]n de sonido|Instant Sound Button|Sound Button).*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!decoded) return null;
  return decoded.slice(0, 120);
}

function normalizeInstantPageUrl(rawHref: string): string | null {
  try {
    const resolved = new URL(rawHref.trim(), "https://www.myinstants.com");
    const validated = validateMyInstantsUrl(resolved.toString());
    if (!INSTANT_PATH_REGEX.test(validated.pathname)) {
      return null;
    }
    const normalizedPath = validated.pathname.endsWith("/") ? validated.pathname : `${validated.pathname}/`;
    return `https://www.myinstants.com${normalizedPath}`;
  } catch {
    return null;
  }
}

function extractCardMediaUrl(block: string): string | null {
  const match = block.match(PLAY_CALL_REGEX) ?? block.match(MEDIA_PATH_REGEX);
  if (!match?.[1]) return null;
  try {
    return validateMyInstantsUrl(`https://www.myinstants.com${match[1]}`).toString();
  } catch {
    return null;
  }
}

export function extractMyInstantsFromHtml(html: string): ExtractedMyInstantsPage {
  const mediaMatch =
    html.match(PRIMARY_BUTTON_REGEX) ?? html.match(DOWNLOAD_LINK_REGEX) ?? html.match(MEDIA_PATH_REGEX);
  if (!mediaMatch || !mediaMatch[1]) {
    throw new StikSoundError("remote-unavailable", "No MyInstants media URL found in page HTML.");
  }

  const candidateUrl = `https://www.myinstants.com${mediaMatch[1]}`;
  const validated = validateMyInstantsUrl(candidateUrl);

  const ogMatch = html.match(OG_TITLE_REGEX) ?? html.match(OG_TITLE_REV_REGEX);
  const titleMatch = html.match(TITLE_TAG_REGEX);
  const rawTitle = ogMatch?.[1] ?? titleMatch?.[1] ?? null;

  return {
    title: cleanTitle(rawTitle),
    media_url: validated.toString()
  };
}

/**
 * Pure parser for MyInstants search pages (`/search/?name=...`).
 * Extracts up to `limit` unique results, validating every returned URL against the strict allowlist.
 */
export function extractMyInstantsSearchResults(html: string, limit: number = 5): MyInstantsSearchResult[] {
  const maxResults = Math.min(20, Math.max(1, Math.floor(Number.isFinite(limit) ? limit : 5)));
  const results: MyInstantsSearchResult[] = [];
  const seen = new Set<string>();

  const blocks = html.split(INSTANT_CARD_SPLIT_REGEX).slice(1);
  if (blocks.length > 0) {
    for (const block of blocks) {
      if (results.length >= maxResults) break;
      INSTANT_LINK_REGEX.lastIndex = 0;
      const linkMatch = INSTANT_LINK_REGEX.exec(block);
      if (!linkMatch) continue;
      const hrefMatch = linkMatch[1]?.match(HREF_ATTR_REGEX);
      const pageUrl = hrefMatch?.[1] ? normalizeInstantPageUrl(hrefMatch[1]) : null;
      const title = cleanTitle(linkMatch[2] ?? null);
      if (!pageUrl || !title || seen.has(pageUrl)) continue;
      seen.add(pageUrl);
      results.push({
        title,
        page_url: pageUrl,
        media_url: extractCardMediaUrl(block)
      });
    }
    return results;
  }

  // Fallback if card container class changes: scan instant links directly.
  INSTANT_LINK_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = INSTANT_LINK_REGEX.exec(html)) !== null && results.length < maxResults) {
    const hrefMatch = match[1]?.match(HREF_ATTR_REGEX);
    const pageUrl = hrefMatch?.[1] ? normalizeInstantPageUrl(hrefMatch[1]) : null;
    const title = cleanTitle(match[2] ?? null);
    if (!pageUrl || !title || seen.has(pageUrl)) continue;
    seen.add(pageUrl);
    results.push({
      title,
      page_url: pageUrl,
      media_url: null
    });
  }
  return results;
}
