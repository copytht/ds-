import type { ActionFrame } from "./actionstream";

/**
 * 当前页面的最小状态。这个执行器跑在目标标签页的内容脚本（ISOLATED 世界）里，
 * 读到的是那个标签页的 DOM；只返回结构稳定、不随 DeepSeek 前端改版一夜崩掉的东西——
 * 地址、标题、写作框在不在。要读 React 状态 / webpack 模块再另开一跳。
 */
export type PageState = {
  readonly url: string;
  readonly title: string;
  readonly composerPresent: boolean;
};

/** 写作框的认定放宽到两类容器：`<textarea>` 与 contenteditable（DeepSeek 前端两代都用过）。 */
const COMPOSER_SELECTOR = "textarea, [contenteditable='true']";

/** 名字对齐 dsb 名册里的 `page.state`（`dsb/actions.py:59-61`）。`frame` 不用：读的就是本标签页。 */
export function readPageState(_frame: ActionFrame): PageState {
  return {
    url: location.href,
    title: document.title,
    composerPresent: document.querySelector(COMPOSER_SELECTOR) !== null,
  };
}
