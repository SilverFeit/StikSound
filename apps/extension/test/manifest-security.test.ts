import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("SEC-011: Chrome Extension Manifest V3 security boundary & views", () => {
  it("contains only downloads, sidePanel, storage, and MyInstants host permissions with no content scripts", () => {
    const extensionRoot = path.resolve(__dirname, "..");
    const manifestPath = path.resolve(extensionRoot, "public/manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as {
      manifest_version: number;
      action?: { default_popup?: string };
      side_panel?: { default_path?: string };
      permissions: string[];
      host_permissions: string[];
      content_scripts?: unknown;
    };

    expect(manifest.manifest_version).toBe(3);
    expect(manifest.action?.default_popup).toBe("popup.html");
    expect(manifest.side_panel?.default_path).toBe("sidepanel.html");
    expect(manifest.permissions.slice().sort()).toEqual(["downloads", "sidePanel", "storage"]);
    expect(manifest.host_permissions.slice().sort()).toEqual([
      "https://myinstants.com/*",
      "https://www.myinstants.com/*"
    ]);
    expect(manifest.content_scripts).toBeUndefined();
    expect(JSON.stringify(manifest)).not.toContain("whatsapp");
    expect(JSON.stringify(manifest)).not.toContain("<all_urls>");

    expect(fs.readFileSync(path.resolve(extensionRoot, "popup.html"), "utf-8")).toContain(
      'data-stik-view="popup"'
    );
    expect(fs.readFileSync(path.resolve(extensionRoot, "sidepanel.html"), "utf-8")).toContain(
      'data-stik-view="sidepanel"'
    );
    expect(fs.readFileSync(path.resolve(extensionRoot, "editor.html"), "utf-8")).toContain(
      'data-stik-view="tab"'
    );
  });
});
