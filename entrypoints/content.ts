import { defineContentScript } from "wxt/utils/define-content-script";

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_idle",
  main() {
    // 页面世界里的逻辑写在这里，或放在 entrypoints/*.content.ts 中拆分。
  },
});
