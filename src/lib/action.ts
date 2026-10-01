/**
 * 页面动作的执行与回传（ADR-0007 扩展侧）：谁执行、结果怎么交回中继。
 *
 * 中继那边 `POST /action` 阻塞等着，这边执行完 `POST /action/result` 把账交回去
 * （回传端点不验 token，认人靠帧里的 `id`），挂着的那次提交就原地返回了。
 *
 * 两边都要挡总开关：中继有 `disabled`，这边在执行前再读一次——用户刚关掉的那一下，
 * 已经在流上的动作也拿不到执行，但**要当场回一个 `disabled`**，不能静默不回：
 * 中继那边 `wait(timeout)` 没人接账就只能等满 30s 判 `timeout`，把「用户关了」这个
 * 有信息量的原因吞成一个没有信息量的码。
 */

import type { ActionFrame } from "./actionstream";

/** 回传端点：不验 token（扩展给不到），形状按 dsb/actions.py 的 `record_result`。 */
export const ACTION_RESULT_URL = "http://127.0.0.1:8787/action/result";

/** 权限钉死的那个站点：标签页只认它（manifest 的 host_permissions 同一个域）。 */
export const DEEPSEEK_HOST = "chat.deepseek.com";

/** `tabs.list` 里的一项：id 是往标签页里执行动作的地址，url 是会话地址。 */
export type SessionTab = {
  readonly id: number;
  readonly title: string;
  readonly url: string;
};

/** `chrome.tabs.query` 的最小面：多一个参数都不用（测试喂假的就照这个）。 */
export type TabsApi = {
  query(query: { currentWindow?: boolean }): Promise<readonly TabCandidate[]>;
};

export type TabCandidate = {
  readonly id?: number;
  readonly title?: string;
  readonly url?: string;
};

/** 执行结果：与中继回给提交方的 `{"ok":true,...}` / `{"ok":false,...}` 同构。 */
export type ActionOutcome =
  { readonly ok: true; readonly result: unknown } | { readonly ok: false; readonly error: string };

/** 失败码：与 `dsb/actions.py` 的 `ACTION_ERRORS`、`protocol/fixtures/action.json` 同一份。 */
export const ACTION_ERROR_DISABLED = "disabled";
/** 名册有、扩展还没实现的动作：当场说「不认这个名字」，别让中继等满 30s 判 timeout。 */
export const ACTION_ERROR_UNKNOWN = "unknown-action";
/** 目标标签页不在 / 这一跳没走通（target 认不出、没接执行口、消息没送到内容脚本）。 */
export const ACTION_ERROR_TAB_GONE = "tab-gone";

/**
 * 「代你发言」闸下的动作：**动写作框的**那些。读（`composer.read`）不受管——
 * 看一眼你写了什么不算替你开口。闸关着时这些一律回 `disabled`。
 */
export const SPEAK_GATED_ACTIONS: ReadonlySet<string> = new Set([
  "composer.type",
  "composer.clear",
  "send.click",
  "send.enter",
]);

/** 执行结果的同构校验：对端答的形状不合线协议的一律不算成功（只有 ok/result、ok/error 两条）。 */
export function isActionOutcome(value: unknown): value is ActionOutcome {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  // `ok:true` 必须带一个非 undefined 的 result：`{ok:true}` 与 `{ok:true,result:undefined}`
  // 都不算成功，别把它们当成功收下。
  if (record["ok"] === true) return record["result"] !== undefined;
  if (record["ok"] === false) {
    return typeof record["error"] === "string" && record["error"] !== "";
  }
  return false;
}

export type ActionContext = {
  /** 动作现读总开关：关着不执行，回 `disabled`（中继侧另有 `disabled` 挡着）。 */
  readonly enabled: boolean;
  /** 「代你发言」闸：关着时动写作框的动作回 `disabled`（见 `SPEAK_GATED_ACTIONS`）。 */
  readonly speak: boolean;
  readonly tabs: TabsApi;
  /**
   * target 标签页的执行口：把帧送到那个标签页并拿回结果。
   * 抛错 / 答不上同构载荷都由这一层折成 `tab-gone`（见 `sendMessageSendToTab`），
   * 所以签名收紧成非空的 `ActionOutcome`——`runAction` 只管透传。
   */
  readonly sendToTab?: (tabId: number, frame: ActionFrame) => Promise<ActionOutcome>;
};

/** 这条 url 是不是 chat.deepseek.com 的（认不出的、别的站的一律不算）。 */
export function isDeepSeekUrl(url: string): boolean {
  try {
    return new URL(url).hostname === DEEPSEEK_HOST;
  } catch {
    return false;
  }
}

/**
 * `tabs.list` 执行器：当前打开的 chat.deepseek.com 标签页，每项 `{id, title, url}`。
 *
 * 没有 `id` 的标签页投不进动作（没有地址可投）、认不出的 url 直接丢——
 * 少一项也比把别的站混进来强。
 */
export async function listSessionTabs(tabs: TabsApi): Promise<SessionTab[]> {
  const candidates = await tabs.query({});
  const sessions: SessionTab[] = [];
  for (const tab of candidates) {
    if (tab.id === undefined || typeof tab.url !== "string" || !isDeepSeekUrl(tab.url)) continue;
    sessions.push({
      id: tab.id,
      title: typeof tab.title === "string" ? tab.title : "",
      url: tab.url,
    });
  }
  return sessions;
}

/**
 * 一件动作 → 回传什么。**每条路都当场回一个册子里的码，没有「不回」这一说**：
 * 中继那边 `wait(timeout)` 一直没人接账，就会等满 30s 判 `timeout`，把真正的原因吞掉。
 *
 * - 总开关关着 → `disabled`；
 * - 名册有、扩展还没实现 → `unknown-action`；
 * - 带了 target 但这一跳走不通（target 不是整数串 / 没接执行口 / 执行口答不出同构载荷）
 *   → `tab-gone`；
 * - `tabs.list` 走 `listSessionTabs`，成功回 `result`。
 */
export async function runAction(
  frame: ActionFrame,
  context: ActionContext,
): Promise<ActionOutcome> {
  if (!context.enabled) return { ok: false, error: ACTION_ERROR_DISABLED };
  // 「代你发言」闸：动写作框的动作要这个闸开着，读不受管。
  if (SPEAK_GATED_ACTIONS.has(frame.action) && !context.speak) {
    return { ok: false, error: ACTION_ERROR_DISABLED };
  }
  if (frame.target !== null) {
    // 只认纯数字串：`Number()` 太宽——`""` / `" "` 会收成 0，`"1e3"` / `"0x10"` / `"-1"`
    // / `"+1"` 也都不是标签页地址。再收紧到 `Number.isSafeInteger`，超出安全整数的长串一并挡掉。
    const tabId = /^\d+$/.test(frame.target) ? Number(frame.target) : Number.NaN;
    if (!Number.isSafeInteger(tabId) || context.sendToTab === undefined) {
      return { ok: false, error: ACTION_ERROR_TAB_GONE };
    }
    return context.sendToTab(tabId, frame);
  }
  if (frame.action === "tabs.list") {
    return { ok: true, result: { tabs: await listSessionTabs(context.tabs) } };
  }
  return { ok: false, error: ACTION_ERROR_UNKNOWN }; // 名册有、扩展还没实现
}

/**
 * background 那一跳的执行口：`browser.tabs.sendMessage` 会因为标签页没了 / 内容脚本
 * 没注入而抛错，抛错不许冒到 `handleAction` 的 catch（那会变成 30s 的 `timeout`），
 * 当场折成 `tab-gone`；答的形状不是同构载荷同样折掉。
 *
 * 只吃一个 `sendMessage` 最小面：不碰 `browser.*`，测试喂假的就照这个。
 */
export type SendMessage = (tabId: number, frame: ActionFrame) => Promise<unknown>;

export function sendMessageSendToTab(
  sendMessage: SendMessage,
): (tabId: number, frame: ActionFrame) => Promise<ActionOutcome> {
  return async (tabId, frame) => {
    try {
      const response = await sendMessage(tabId, frame);
      return isActionOutcome(response) ? response : { ok: false, error: ACTION_ERROR_TAB_GONE };
    } catch {
      return { ok: false, error: ACTION_ERROR_TAB_GONE };
    }
  };
}

/** 回传要用的 `fetch` 最小面（本机回传，不带 token）。 */
export type PostResult = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<unknown>;

/** 把结果交回中继：成功带 `result`、失败带 `error`，`id` 原样还回去。 */
export async function postActionResult(
  post: PostResult,
  id: string,
  outcome: ActionOutcome,
): Promise<void> {
  const payload = outcome.ok
    ? { id, ok: true, result: outcome.result }
    : { id, ok: false, error: outcome.error };
  await post(ACTION_RESULT_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}
