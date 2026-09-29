import { browser } from "wxt/browser";
import { defineContentScript } from "wxt/utils/define-content-script";

import {
  parseToggleMessage,
  readToggle,
  stateMessage,
  TOGGLE_STORAGE_KEY,
} from "../src/lib/toggle";

/**
 * 总开关的隔离世界一侧：读 `browser.storage.local`，把状态交给页面世界。
 *
 * 站点范围在 manifest 权限里钉死为 chat.deepseek.com（权限钉死），
 * 总开关不参与站点判定，只决定页面世界要不要接管。
 */
export default defineContentScript({
  matches: ["https://chat.deepseek.com/*"],
  runAt: "document_start",
  async main() {
    const broadcast = async () => {
      const stored = await browser.storage.local.get(TOGGLE_STORAGE_KEY);
      window.postMessage(stateMessage(readToggle(stored[TOGGLE_STORAGE_KEY])), "*");
    };

    // 两个内容脚本谁先谁后都可能：页面世界开口要就答一次，这边自己上来也报一次。
    window.addEventListener("message", (event) => {
      if (event.source !== window) return;
      const message = parseToggleMessage(event.data);
      if (message?.kind === "want-state") void broadcast();
    });

    // 总开关改了立刻广播，刷新与重启靠 storage 自己保持。
    browser.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local") return;
      if (!(TOGGLE_STORAGE_KEY in changes)) return;
      void broadcast();
    });

    await broadcast();
  },
});
