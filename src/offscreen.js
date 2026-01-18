import { ensureAuth, saveEntry } from "./firebase.local.js";

let ready = false;

(async () => {
  await ensureAuth();
  ready = true;
  chrome.runtime.sendMessage({ type: "OFFSCREEN_READY" });
})();

chrome.runtime.onMessage.addListener(async (msg) => {
  if (msg.type === "SAVE_ENTRY" && ready) {
    try {
      await saveEntry(msg.payload);
      console.log("Saved via Offscreen");
    } catch (e) {
      console.error("Save failed", e);
    }
  }
});