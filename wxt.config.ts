import { defineConfig } from "wxt";

export default defineConfig({
  manifest: {
    name: "ds-",
    description: "Browser extension built with WXT",
    // 权限钉死：站点范围在申请权限的那一刻就固定为 chat.deepseek.com，
    // 运行期不接受任何切换或扩权；总开关不参与站点判定。
    host_permissions: ["https://chat.deepseek.com/*"],
    // 浏览器权限只有两个，都跟站点范围无关：storage 存总开关（默认关），
    // alarms 排周期探活（开关开着才排，30s 一次）。站点权限与浏览器权限分开，
    // 不靠任何浏览器权限去扩站点范围。
    permissions: ["storage", "alarms"],
    // 工具栏图标即状态位（三态像素与悬停文案由 background 现算）；
    // 不建 popup、不建 options 页，这里只给个默认标题把 action 声明出来。
    // 静态图标是 background 还没 setIcon 前的兜底，画的是 "off" 态（默认关）。
    action: {
      default_title: "ds-",
      default_icon: {
        16: "icon/16.png",
        32: "icon/32.png",
      },
    },
    icons: {
      16: "icon/16.png",
      32: "icon/32.png",
      48: "icon/48.png",
      128: "icon/128.png",
    },
  },
});
