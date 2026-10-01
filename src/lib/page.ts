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

/** 写作框：优先 `<textarea>`（DeepSeek 现在就是），退到 contenteditable。 */
function composerElement(): HTMLElement | null {
  return document.querySelector<HTMLElement>(COMPOSER_SELECTOR);
}

/**
 * 写进受控输入：走**原型上的原生 value setter**，再派一个冒泡的 `input`。
 * 直接 `el.value = x` 会被 React 的 value tracker 吞掉——页面看着像没写过。
 */
function writeComposer(el: HTMLElement, text: string): void {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
    Object.getOwnPropertyDescriptor(proto.prototype, "value")?.set?.call(el, text);
  } else {
    el.textContent = text;
  }
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/** 读写作框里现有的字（不发送）。 */
export function readComposer(_frame: ActionFrame): { text: string } {
  const el = composerElement();
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    return { text: el.value };
  }
  return { text: el?.textContent ?? "" };
}

/** 往写作框写一段字（**不发送**）。`params.text` 不是字符串就写空。 */
export function typeComposer(frame: ActionFrame): Record<string, never> {
  const el = composerElement();
  if (el === null) throw new Error("页面上没有写作框");
  const text = frame.params["text"];
  writeComposer(el, typeof text === "string" ? text : "");
  return {};
}

/** 清空写作框（**不发送**）。 */
export function clearComposer(_frame: ActionFrame): Record<string, never> {
  const el = composerElement();
  if (el === null) throw new Error("页面上没有写作框");
  writeComposer(el, "");
  return {};
}

/** 站点设计系统的发送键（圆箭头）；**禁用看 class**——它没有 `disabled` 属性。 */
const SEND_SELECTOR = 'div[role="button"].ds-button--primary.ds-button--filled.ds-button--circle';

/** 点站点自己的发送键（走它的发送路径）。键不可用（空输入框等）就抛，别假装发过了。 */
export function clickSend(_frame: ActionFrame): Record<string, never> {
  const el = document.querySelector<HTMLElement>(SEND_SELECTOR);
  if (el === null || el.classList.contains("ds-button--disabled")) {
    throw new Error("发送键不可用");
  }
  el.click();
  return {};
}

/** 在写作框上按回车（站点自己也接这条路）。 */
export function pressEnter(_frame: ActionFrame): Record<string, never> {
  const el = composerElement();
  if (el === null) throw new Error("页面上没有写作框");
  const opts = {
    key: "Enter",
    code: "Enter",
    keyCode: 13,
    which: 13,
    bubbles: true,
    cancelable: true,
  };
  el.dispatchEvent(new KeyboardEvent("keydown", opts));
  el.dispatchEvent(new KeyboardEvent("keyup", opts));
  return {};
}

/** 「开启新对话」：侧栏那个 `tabindex=0` 的条目。文字是**本地化**的，认不出就抛。 */
export function newChat(_frame: ActionFrame): Record<string, never> {
  const entries = document.querySelectorAll<HTMLElement>('[tabindex="0"]');
  const el = [...entries].find((entry) => (entry.textContent || "").trim() === "开启新对话");
  if (el === undefined) throw new Error("找不到「开启新对话」");
  el.click();
  return {};
}
