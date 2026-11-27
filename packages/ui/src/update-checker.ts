export interface ReleaseInfo {
  version: string;
  url: string;
}

export interface CheckLatestReleaseOptions {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  storage?: Pick<Storage, "getItem" | "setItem"> | null;
  now?: () => number;
  cacheTtlMs?: number;
}

export const GITHUB_RELEASES_API_URL =
  "https://api.github.com/repos/SilverFeit/StikSound/releases/latest";
export const GITHUB_RELEASES_PAGE_URL =
  "https://github.com/SilverFeit/StikSound/releases/latest";

const RELEASE_URL_PREFIX = "https://github.com/SilverFeit/StikSound/releases/";
const CACHE_KEY = "stiksound:latest-release:v1";
const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 6_000;

interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

interface CachedRelease {
  checkedAt: number;
  version: string;
  url: string;
}

export function normalizeVersion(raw: string): string {
  return raw.trim().replace(/^v/i, "");
}

export function parseSemver(raw: string): ParsedSemver | null {
  const cleaned = normalizeVersion(raw);
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(cleaned);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split(".") : []
  };
}

function comparePrerelease(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;

  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const partA = a[i];
    const partB = b[i];
    if (partA === undefined) return -1;
    if (partB === undefined) return 1;

    const numA = /^\d+$/.test(partA) ? Number(partA) : null;
    const numB = /^\d+$/.test(partB) ? Number(partB) : null;

    if (numA !== null && numB !== null) {
      if (numA !== numB) return numA > numB ? 1 : -1;
    } else if (numA !== null) {
      return -1;
    } else if (numB !== null) {
      return 1;
    } else if (partA !== partB) {
      return partA > partB ? 1 : -1;
    }
  }
  return 0;
}

export function compareSemver(a: string, b: string): number | null {
  const parsedA = parseSemver(a);
  const parsedB = parseSemver(b);
  if (!parsedA || !parsedB) return null;

  if (parsedA.major !== parsedB.major) return parsedA.major > parsedB.major ? 1 : -1;
  if (parsedA.minor !== parsedB.minor) return parsedA.minor > parsedB.minor ? 1 : -1;
  if (parsedA.patch !== parsedB.patch) return parsedA.patch > parsedB.patch ? 1 : -1;

  return comparePrerelease(parsedA.prerelease, parsedB.prerelease);
}

export function isNewerVersion(candidate: string, current: string): boolean {
  return compareSemver(candidate, current) === 1;
}

function sanitizeReleaseUrl(rawUrl: unknown): string {
  if (typeof rawUrl === "string" && rawUrl.startsWith(RELEASE_URL_PREFIX)) {
    return rawUrl;
  }
  return GITHUB_RELEASES_PAGE_URL;
}

function resolveStorage(
  override: Pick<Storage, "getItem" | "setItem"> | null | undefined
): Pick<Storage, "getItem" | "setItem"> | null {
  if (override !== undefined) return override;
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

function readCachedRelease(
  storage: Pick<Storage, "getItem" | "setItem"> | null,
  nowMs: number,
  cacheTtlMs: number
): CachedRelease | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedRelease>;
    if (
      typeof parsed.checkedAt !== "number" ||
      typeof parsed.version !== "string" ||
      !parseSemver(parsed.version)
    ) {
      return null;
    }
    if (nowMs - parsed.checkedAt >= cacheTtlMs) return null;
    return {
      checkedAt: parsed.checkedAt,
      version: normalizeVersion(parsed.version),
      url: sanitizeReleaseUrl(parsed.url)
    };
  } catch {
    return null;
  }
}

function writeCachedRelease(
  storage: Pick<Storage, "getItem" | "setItem"> | null,
  entry: CachedRelease
): void {
  if (!storage) return;
  try {
    storage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    // Ignore quota or storage restriction errors
  }
}

export async function checkLatestRelease(
  currentVersion: string,
  options: CheckLatestReleaseOptions = {}
): Promise<ReleaseInfo | null> {
  if (!parseSemver(currentVersion)) return null;

  const now = options.now ?? (() => Date.now());
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const storage = resolveStorage(options.storage);
  const nowMs = now();

  const cached = readCachedRelease(storage, nowMs, cacheTtlMs);
  if (cached) {
    return isNewerVersion(cached.version, currentVersion)
      ? { version: cached.version, url: cached.url }
      : null;
  }

  const fetchImpl = options.fetchImpl ?? (typeof fetch === "function" ? fetch : undefined);
  if (!fetchImpl) return null;

  const timeoutController = typeof AbortController !== "undefined" ? new AbortController() : undefined;
  const onParentAbort = () => timeoutController?.abort();
  if (options.signal) {
    if (options.signal.aborted) return null;
    options.signal.addEventListener("abort", onParentAbort, { once: true });
  }
  const timer =
    timeoutController !== undefined
      ? setTimeout(() => timeoutController.abort(), REQUEST_TIMEOUT_MS)
      : undefined;

  try {
    const response = await fetchImpl(GITHUB_RELEASES_API_URL, {
      headers: { Accept: "application/vnd.github+json" },
      signal: timeoutController?.signal
    });
    if (!response.ok) return null;

    const payload = (await response.json()) as {
      tag_name?: unknown;
      html_url?: unknown;
      draft?: unknown;
      prerelease?: unknown;
    };

    if (payload.draft === true || payload.prerelease === true) return null;
    if (typeof payload.tag_name !== "string") return null;

    const latestVersion = normalizeVersion(payload.tag_name);
    if (!parseSemver(latestVersion)) return null;

    const releaseUrl = sanitizeReleaseUrl(payload.html_url);
    writeCachedRelease(storage, {
      checkedAt: nowMs,
      version: latestVersion,
      url: releaseUrl
    });

    return isNewerVersion(latestVersion, currentVersion)
      ? { version: latestVersion, url: releaseUrl }
      : null;
  } catch {
    return null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    options.signal?.removeEventListener("abort", onParentAbort);
  }
}
