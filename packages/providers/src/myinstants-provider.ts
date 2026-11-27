import { LIMITS, StikSoundError, type SoundProvider } from "@stiksound/core";
import {
  extractMyInstantsFromHtml,
  extractMyInstantsSearchResults,
  type MyInstantsSearchResult
} from "./myinstants-extractor";
import { validateMyInstantsUrl } from "./url-policy";

export type FetchLike = typeof fetch;

export interface MyInstantsSearchOptions {
  limit?: number;
  locale?: string;
}

const DIRECT_MEDIA_PATH_REGEX = /^\/media\/sounds\/[^/]+\.(mp3|wav|ogg|m4a)$/i;
const INSTANT_PAGE_PATH_REGEX = /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?instant\/[^/]+\/?$/i;
const LOCALE_SEGMENT_REGEX = /^[a-z]{2}(?:-[a-z]{2})?$/i;

export class MyInstantsProvider implements SoundProvider {
  public readonly id = "myinstants";

  constructor(private readonly fetchFn: FetchLike = globalThis.fetch) {}

  public canResolve(rawUrl: string): boolean {
    try {
      const url = validateMyInstantsUrl(rawUrl);
      return DIRECT_MEDIA_PATH_REGEX.test(url.pathname) || INSTANT_PAGE_PATH_REGEX.test(url.pathname);
    } catch {
      return false;
    }
  }

  public async search(rawQuery: string, options: MyInstantsSearchOptions = {}): Promise<MyInstantsSearchResult[]> {
    const query = rawQuery.trim();
    if (!query || query.length > 120) {
      throw new StikSoundError("url-rejected", "Search query must be between 1 and 120 characters.");
    }
    const locale = (options.locale ?? "en").trim().toLowerCase();
    if (!LOCALE_SEGMENT_REGEX.test(locale)) {
      throw new StikSoundError("url-rejected", `Invalid MyInstants search locale: ${options.locale}`);
    }
    const searchUrl = `https://www.myinstants.com/${locale}/search/?name=${encodeURIComponent(query)}`;
    const htmlBytes = await this.fetchLimitedBytes(searchUrl, 2 * 1024 * 1024);
    const html = new TextDecoder("utf-8", { fatal: false }).decode(htmlBytes);
    return extractMyInstantsSearchResults(html, options.limit ?? 5);
  }

  public async resolve(rawUrl: string): Promise<{
    page_url: string | null;
    media_url: string;
    title: string | null;
    bytes: Uint8Array;
  }> {
    const initialUrl = validateMyInstantsUrl(rawUrl);

    if (DIRECT_MEDIA_PATH_REGEX.test(initialUrl.pathname)) {
      const bytes = await this.fetchLimitedBytes(initialUrl.toString());
      return {
        page_url: null,
        media_url: initialUrl.toString(),
        title: null,
        bytes
      };
    }

    if (!INSTANT_PAGE_PATH_REGEX.test(initialUrl.pathname)) {
      throw new StikSoundError("url-rejected", "URL is not a MyInstants instant page or direct media file.");
    }

    // Strip query strings and normalize trailing slash for instant pages
    const normalizedPath = initialUrl.pathname.endsWith("/")
      ? initialUrl.pathname
      : `${initialUrl.pathname}/`;
    const canonicalPageUrl = `${initialUrl.origin}${normalizedPath}`;
    const htmlBytes = await this.fetchLimitedBytes(canonicalPageUrl, 2 * 1024 * 1024);
    const html = new TextDecoder("utf-8", { fatal: false }).decode(htmlBytes);
    const extracted = extractMyInstantsFromHtml(html);
    const audioBytes = await this.fetchLimitedBytes(extracted.media_url, LIMITS.MAX_AUDIO_BYTES);

    return {
      page_url: canonicalPageUrl,
      media_url: extracted.media_url,
      title: extracted.title,
      bytes: audioBytes
    };
  }

  private async fetchLimitedBytes(
    targetUrl: string,
    maxBytes: number = LIMITS.MAX_AUDIO_BYTES
  ): Promise<Uint8Array> {
    let currentUrl = validateMyInstantsUrl(targetUrl).toString();

    for (let redirectCount = 0; redirectCount <= LIMITS.MAX_REDIRECTS; redirectCount++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), LIMITS.FETCH_TIMEOUT_MS);
      let response: Response;
      try {
        response = await this.fetchFn(currentUrl, {
          method: "GET",
          redirect: "manual",
          credentials: "omit",
          signal: controller.signal
        });
      } catch (err) {
        clearTimeout(timer);
        if (err instanceof StikSoundError) throw err;
        throw new StikSoundError("remote-unavailable", "Network error or timeout while contacting MyInstants.");
      }
      clearTimeout(timer);

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location || redirectCount === LIMITS.MAX_REDIRECTS) {
          throw new StikSoundError("url-rejected", "Too many redirects or missing Location header.");
        }
        const resolvedRedirect = new URL(location, currentUrl).toString();
        currentUrl = validateMyInstantsUrl(resolvedRedirect).toString();
        continue;
      }

      if (response.status === 413) {
        throw new StikSoundError("file-too-large", "Remote response exceeds 25 MB limit.");
      }
      if (response.status === 403) {
        throw new StikSoundError("url-rejected", "URL rejected by MyInstants security policy.");
      }
      if (!response.ok) {
        throw new StikSoundError("remote-unavailable", `HTTP ${response.status} from MyInstants.`);
      }

      const contentLengthHeader = response.headers.get("content-length");
      if (contentLengthHeader) {
        const len = Number(contentLengthHeader);
        if (Number.isFinite(len) && len > maxBytes) {
          throw new StikSoundError("file-too-large", `Remote response exceeds ${maxBytes} bytes.`);
        }
      }

      if (!response.body) {
        const arr = new Uint8Array(await response.arrayBuffer());
        if (arr.byteLength > maxBytes) {
          throw new StikSoundError("file-too-large", `Remote body exceeds ${maxBytes} bytes.`);
        }
        return arr;
      }

      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          total += value.byteLength;
          if (total > maxBytes) {
            await reader.cancel();
            throw new StikSoundError("file-too-large", `Remote stream exceeded ${maxBytes} bytes.`);
          }
          chunks.push(value);
        }
      }

      const out = new Uint8Array(total);
      let offset = 0;
      for (const c of chunks) {
        out.set(c, offset);
        offset += c.byteLength;
      }
      return out;
    }

    throw new StikSoundError("url-rejected", "Redirect limit exceeded.");
  }
}
