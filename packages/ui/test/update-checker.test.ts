import { describe, expect, it, vi } from "vitest";
import {
  GITHUB_RELEASES_PAGE_URL,
  checkLatestRelease,
  compareSemver,
  isNewerVersion
} from "../src/update-checker";

function createMemoryStorage(): Pick<Storage, "getItem" | "setItem"> {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    }
  };
}

describe("update-checker", () => {
  it("compares semantic versions accurately including v prefix, multi-digit parts, and prereleases", () => {
    expect(compareSemver("v1.1.5", "1.1.4")).toBe(1);
    expect(compareSemver("1.10.0", "1.2.0")).toBe(1);
    expect(compareSemver("2.0.0", "1.9.9")).toBe(1);
    expect(compareSemver("v1.1.4", "1.1.4")).toBe(0);
    expect(compareSemver("1.1.3", "1.1.4")).toBe(-1);
    expect(compareSemver("1.2.0", "1.2.0-beta.1")).toBe(1);
    expect(compareSemver("not-a-version", "1.1.4")).toBeNull();

    expect(isNewerVersion("v1.2.0", "1.1.4")).toBe(true);
    expect(isNewerVersion("v1.1.4", "1.1.4")).toBe(false);
    expect(isNewerVersion("v1.1.3", "1.1.4")).toBe(false);
  });

  it("returns release info when GitHub latest release is newer and caches within TTL", async () => {
    const storage = createMemoryStorage();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          tag_name: "v1.2.0",
          html_url: "https://github.com/SilverFeit/StikSound/releases/tag/v1.2.0",
          draft: false,
          prerelease: false
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    let currentTime = 1_000_000;
    const first = await checkLatestRelease("1.1.4", {
      fetchImpl: fetchMock as unknown as typeof fetch,
      storage,
      now: () => currentTime,
      cacheTtlMs: 60_000
    });

    expect(first).toEqual({
      version: "1.2.0",
      url: "https://github.com/SilverFeit/StikSound/releases/tag/v1.2.0"
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Within TTL: served from cache without another network call
    currentTime += 10_000;
    const cachedHit = await checkLatestRelease("1.1.4", {
      fetchImpl: fetchMock as unknown as typeof fetch,
      storage,
      now: () => currentTime,
      cacheTtlMs: 60_000
    });
    expect(cachedHit).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Once upgraded to 1.2.0, cached 1.2.0 is immediately recognized as up to date
    const afterUpgrade = await checkLatestRelease("1.2.0", {
      fetchImpl: fetchMock as unknown as typeof fetch,
      storage,
      now: () => currentTime,
      cacheTtlMs: 60_000
    });
    expect(afterUpgrade).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // After TTL expires, fetches again
    currentTime += 60_000;
    await checkLatestRelease("1.1.4", {
      fetchImpl: fetchMock as unknown as typeof fetch,
      storage,
      now: () => currentTime,
      cacheTtlMs: 60_000
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("ignores drafts, prereleases, same/older versions, network errors, and sanitizes release URLs", async () => {
    const draftFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ tag_name: "v9.9.9", draft: true }), { status: 200 })
    );
    expect(
      await checkLatestRelease("1.1.4", {
        fetchImpl: draftFetch as unknown as typeof fetch,
        storage: null
      })
    ).toBeNull();

    const prereleaseFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ tag_name: "v9.9.9", prerelease: true }), { status: 200 })
    );
    expect(
      await checkLatestRelease("1.1.4", {
        fetchImpl: prereleaseFetch as unknown as typeof fetch,
        storage: null
      })
    ).toBeNull();

    const untrustedUrlFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          tag_name: "v1.3.0",
          html_url: "https://evil.example/phish",
          draft: false,
          prerelease: false
        }),
        { status: 200 }
      )
    );
    expect(
      await checkLatestRelease("1.1.4", {
        fetchImpl: untrustedUrlFetch as unknown as typeof fetch,
        storage: null
      })
    ).toEqual({
      version: "1.3.0",
      url: GITHUB_RELEASES_PAGE_URL
    });

    const failingFetch = vi.fn().mockRejectedValue(new Error("offline"));
    expect(
      await checkLatestRelease("1.1.4", {
        fetchImpl: failingFetch as unknown as typeof fetch,
        storage: null
      })
    ).toBeNull();
  });
});
