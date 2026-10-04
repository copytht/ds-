import { ACTION_ERROR_COMPOSER_ABSENT, ACTION_ERROR_PAGE_CHANGED, PageError } from "./action";
import type { ActionFrame } from "./action";

/**
 * 当前页面的最小状态。这个执行器跑在目标标签页的内容脚本（ISOLATED 世界）里，
 * 读到的是那个标签页的 DOM；只返回结构稳定、不随 DeepSeek 前端改版一夜崩掉的东西——
 * 地址、标题、写作框在不在、账号在什么处境上。要读 React 状态 / webpack 模块再另开一跳。
 */
export type PageState = {
  readonly url: string;
  readonly title: string;
  readonly composerPresent: boolean;
  readonly account: AccountState;
};

/**
 * 账号处境（#2）：**写作框不在的时候，页面自己知道为什么，扩展要认出来**。
 * 禁言期间 DeepSeek 干脆不渲染写作框，此前扩展一声不吭地空等一个永远不会出现的
 * 输入框，人在页面上看得见橙条、agent 什么都看不见。
 *
 * - `ready`：写作框在；
 * - `muted`：站点给了处罚句，`until` 是它写着的解封时刻（认不出时刻就是 `null`，
 *   仍然算禁言——认不出时间不等于没禁）；
 * - `signed-out`：站点把没登录的人导到了登录页；
 * - `unknown`：写作框不在、又认不出上面任何一种。**不猜**——分不清就说分不清。
 */
export type AccountState =
  | { readonly kind: "ready" }
  | { readonly kind: "muted"; readonly until: string | null }
  | { readonly kind: "signed-out" }
  | { readonly kind: "unknown" };

/** 写作框的认定放宽到两类容器：`<textarea>` 与 contenteditable（DeepSeek 前端两代都用过）。 */
const COMPOSER_SELECTOR = "textarea, [contenteditable='true']";

/**
 * 处罚句只从警示条里认。会话正文里出现「禁言」是常事（#2 的原话），拿全文去搜
 * 等于把用户聊天里的话当成处罚——所以两头都收：容器是警示条，句子还得同时提到
 * 「账号/你」与「禁言/封禁」。
 */
const ALERT_SELECTOR = ".ds-alert__content";
/** 解封时刻是纯文本（真机 2026-10-02 抄的：页面上既没有 `<time>` 也没有 `datetime`）。 */
const MUTE_UNTIL = /禁言至\s*(\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日\s*\d{1,2}:\d{2})/;
/** 登录页路径（真机实测过：没登录时站点把人导到这儿）。 */
const SIGNED_OUT_PATH = /\/sign_in$/;

/** 警示条里的文本认不认得处罚句；认得出就把站上写的解封时刻一起带出来。 */
export function readMute(root: ParentNode): { readonly until: string | null } | null {
  for (const index of Array.from(root.querySelectorAll(ALERT_SELECTOR)).values()) {
    const text = index.textContent ?? "";
    if (!/(账号|你)/.test(text)) continue;
    if (!/(禁言|封禁)/.test(text)) continue;
    return { until: MUTE_UNTIL.exec(text)?.[1] ?? null };
  }
  return null;
}

/** 写作框在不在 + 账号在什么处境上。写作框不在时才去认处境。 */
export function readAccount(composerPresent: boolean): AccountState {
  if (composerPresent) return { kind: "ready" };
  const mute = readMute(document);
  if (mute !== null) return { kind: "muted", until: mute.until };
  if (SIGNED_OUT_PATH.test(location.pathname)) return { kind: "signed-out" };
  return { kind: "unknown" };
}

/**
 * `AccountState` 的校验：background 侧从标签页回话里读到的是
 * `unknown`，过一遍这个再拿去喂退避判定——形状不对就当认不出
 * （退避闸不猜，放行后由真正的执行去报它该报的码）。
 */
export function isAccountState(value: unknown): value is AccountState {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  switch (record["kind"]) {
    case "ready":
    case "signed-out":
    case "unknown":
      return Object.keys(record).length === 1;
    case "muted":
      return (
        Object.keys(record).length === 2 &&
        (record["until"] === null || typeof record["until"] === "string")
      );
    default:
      return false;
  }
}

/** 写作框在不在（`page.state` 与账号处境周期上报共读这一处）。 */
export function readComposerPresent(): boolean {
  return document.querySelector(COMPOSER_SELECTOR) !== null;
}

/** 名字对齐 dsb 名册里的 `page.state`（`dsb/actions.py:59-61`）。`frame` 不用：读的就是本标签页。 */
export function readPageState(_frame: ActionFrame): PageState {
  const composerPresent = readComposerPresent();
  return {
    url: location.href,
    title: document.title,
    composerPresent,
    account: readAccount(composerPresent),
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
  if (el === null) throw new PageError(ACTION_ERROR_COMPOSER_ABSENT, "页面上没有写作框");
  const text = frame.params["text"];
  writeComposer(el, typeof text === "string" ? text : "");
  return {};
}

/** 清空写作框（**不发送**）。 */
export function clearComposer(_frame: ActionFrame): Record<string, never> {
  const el = composerElement();
  if (el === null) throw new PageError(ACTION_ERROR_COMPOSER_ABSENT, "页面上没有写作框");
  writeComposer(el, "");
  return {};
}

/** 站点设计系统的发送键（圆箭头）；**禁用看 class**——它没有 `disabled` 属性。 */
export const SEND_SELECTOR =
  'div[role="button"].ds-button--primary.ds-button--filled.ds-button--circle';

/**
 * 找站点自己的发送键：不在或被禁用（class 带 `ds-button--disabled`）都回 null。
 * `send.click` 与回灌那条路共读这一处，别再另写一份选择器。
 */
export function findSendButton(): HTMLElement | null {
  const el = document.querySelector<HTMLElement>(SEND_SELECTOR);
  if (el === null) return null;
  if (el.getClientRects().length === 0) return null; // 还没渲染出来：当没找到
  if (el.classList.contains("ds-button--disabled")) return null;
  return el;
}

/** 点站点自己的发送键（走它的发送路径）。键不可用（空输入框等）就抛，别假装发过了。 */
export function clickSend(_frame: ActionFrame): Record<string, never> {
  const el = findSendButton();
  if (el === null) throw new PageError(ACTION_ERROR_PAGE_CHANGED, "发送键不可用");
  el.click();
  return {};
}

/** 在写作框上按回车（站点自己也接这条路）。 */
export function pressEnter(_frame: ActionFrame): Record<string, never> {
  const el = composerElement();
  if (el === null) throw new PageError(ACTION_ERROR_COMPOSER_ABSENT, "页面上没有写作框");
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
  if (el === undefined) throw new PageError(ACTION_ERROR_PAGE_CHANGED, "找不到「开启新对话」");
  el.click();
  return {};
}
