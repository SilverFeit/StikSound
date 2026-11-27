function ensureDefaultPopupBehavior(): void {
  if (typeof chrome !== "undefined" && chrome.sidePanel?.setPanelBehavior) {
    void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => undefined);
  }
}

chrome.runtime.onInstalled.addListener(ensureDefaultPopupBehavior);
chrome.runtime.onStartup.addListener(ensureDefaultPopupBehavior);
