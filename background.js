chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: "save-selection", title: "Capture to Aha!", contexts: ["selection", "page"] });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "save-selection") {
    await chrome.storage.local.set({
      pendingCapture: { text: info.selectionText || "", url: tab.url, mode: "context_menu_modal" }
    });
    // 470x610 matches the 450x590 CSS body + window borders
    chrome.windows.create({ url: "popup.html", type: "popup", width: 470, height: 610, focused: true });
  }
});