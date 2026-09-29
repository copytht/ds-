import { defineConfig } from "wxt";

export default defineConfig({
  manifest: {
    name: "ds-",
    description: "Browser extension built with WXT",
    // 权限钉死：站点范围在申请权限的那一刻就固定为 chat.deepseek.com，
    // 运行期不接受任何切换或扩权；总开关不参与站点判定。
    host_permissions: ["https://chat.deepseek.com/*"],
    // 只为存总开关（browser.storage.local，默认关）加 storage，
    // 站点权限与浏览器权限分开：除此之外不加任何浏览器权限。
    permissions: ["storage"],
  },
});
