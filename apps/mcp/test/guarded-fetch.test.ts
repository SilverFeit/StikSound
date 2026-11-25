import { describe, expect, it, vi } from "vitest";
import type { FetchLike } from "@stiksound/providers";
import { createGuardedFetch } from "../src/guarded-fetch";

function fakeFetch() {
  return vi.fn<FetchLike>(async () => new Response("ok"));
}

describe("apps/mcp guarded fetch (SSRF)", () => {
  it("connects when every resolved address is public and sets a user agent", async () => {
    const base = fakeFetch();
    const guarded = createGuardedFetch(async () => ["104.26.10.20", "2606:4700::6812:a14"], base);
    await guarded("https://www.myinstants.com/en/instant/a/", { redirect: "manual" });
    expect(base).toHaveBeenCalledOnce();
    const init = base.mock.calls[0]![1]!;
    expect(new Headers(init.headers).get("user-agent")).toContain("StikSound");
    expect(init.redirect).toBe("manual");
  });

  it.each([["127.0.0.1"], ["10.0.0.8"], ["169.254.169.254"], ["192.168.1.4"], ["::1"], ["fd00::1"]])(
    "refuses to connect when the host resolves to %s",
    async (address) => {
      const base = fakeFetch();
      const guarded = createGuardedFetch(async () => ["104.26.10.20", address], base);
      await expect(guarded("https://www.myinstants.com/media/sounds/a.mp3")).rejects.toThrowError(/url-rejected/);
      expect(base).not.toHaveBeenCalled();
    }
  );

  it("reports DNS failures and empty answers as remote-unavailable", async () => {
    const base = fakeFetch();
    const failing = createGuardedFetch(async () => {
      throw new Error("ENOTFOUND");
    }, base);
    await expect(failing("https://www.myinstants.com/a")).rejects.toThrowError(/remote-unavailable/);
    await expect(createGuardedFetch(async () => [], base)("https://www.myinstants.com/a")).rejects.toThrowError(
      /remote-unavailable/
    );
    expect(base).not.toHaveBeenCalled();
  });
});
