import React from "react";
import { createRoot } from "react-dom/client";
import { detectLocale, type ExportArtifact } from "@stiksound/core";
import { WebMediaEngine } from "@stiksound/media-web";
import { MyInstantsProvider } from "@stiksound/providers";
import { StikSoundMinimalApp, type ShellBridge } from "@stiksound/ui";
import "../../../packages/ui/src/styles.css";
import "./extension.css";
import pkg from "../package.json";

type ExtensionView = "popup" | "sidepanel" | "tab";

function detectExtensionView(): ExtensionView {
  const attr = document.documentElement.dataset.stikView;
  if (attr === "popup" || attr === "sidepanel" || attr === "tab") {
    return attr;
  }
  return "tab";
}

const currentView = detectExtensionView();

// Prefetch the current windowId so chrome.sidePanel.open({ windowId }) can run synchronously
// inside the click event without losing Chrome's user-gesture token.
let cachedWindowId: number | undefined;
if (currentView === "popup" && typeof chrome !== "undefined" && chrome.windows?.getCurrent) {
  chrome.windows.getCurrent((win) => {
    if (typeof win?.id === "number") {
      cachedWindowId = win.id;
    }
  });
}

async function downloadBytes(bytes: Uint8Array, fileName: string, mimeType: string): Promise<void> {
  const blob = new Blob([bytes.slice().buffer], { type: mimeType });
  const url = URL.createObjectURL(blob);
  try {
    if (typeof chrome !== "undefined" && chrome.downloads?.download) {
      await chrome.downloads.download({
        url,
        filename: fileName,
        saveAs: false
      });
    } else {
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
    }
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

const shell: ShellBridge = {
  async saveArtifact(artifact: ExportArtifact) {
    await downloadBytes(artifact.bytes, artifact.fileName, artifact.mimeType);
  },
  async copyArtifactToClipboard(artifact: ExportArtifact) {
    if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
      try {
        const blob = new Blob([artifact.bytes.slice().buffer], { type: artifact.mimeType });
        await navigator.clipboard.write([new ClipboardItem({ [artifact.mimeType]: blob })]);
      } catch {
        // Fallback: user can use the inline Download button or drag the preview video
      }
    }
  },
  async saveProjectZip(zipBytes: Uint8Array, suggestedName: string) {
    await downloadBytes(zipBytes, suggestedName, "application/zip");
  },
  ...(currentView === "popup" || currentView === "sidepanel"
    ? {
        async openInTab() {
          if (typeof chrome !== "undefined" && chrome.tabs?.create && chrome.runtime?.getURL) {
            await chrome.tabs.create({ url: chrome.runtime.getURL("editor.html") });
            window.close();
          }
        }
      }
    : {}),
  ...(currentView === "popup"
    ? {
        openSidePanel() {
          if (typeof chrome === "undefined" || !chrome.sidePanel?.open) return;
          const openForWindow = (windowId: number) => {
            void chrome.sidePanel
              .open({ windowId })
              .then(() => {
                window.close();
              })
              .catch(() => undefined);
          };
          if (typeof cachedWindowId === "number") {
            openForWindow(cachedWindowId);
          } else if (chrome.windows?.getCurrent) {
            chrome.windows.getCurrent((win) => {
              if (typeof win?.id === "number") {
                openForWindow(win.id);
              }
            });
          }
        }
      }
    : {})
};

const appVersion =
  (typeof chrome !== "undefined" && chrome.runtime?.getManifest?.()?.version) || pkg.version;

const engine = new WebMediaEngine();
const providers = [new MyInstantsProvider()];
const locale = detectLocale(navigator.language);

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <StikSoundMinimalApp
      engine={engine}
      providers={providers}
      shell={shell}
      initialLocale={locale}
      appVersion={appVersion}
    />
  </React.StrictMode>
);
