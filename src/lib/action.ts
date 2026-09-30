/**
 * 页面动作的执行与回传（ADR-0007 扩展侧）：谁执行、结果怎么交回中继。
 *
 * 中继那边 `POST /action` 阻塞等着，这边执行完 `POST /action/result` 把账交回去
 * （回传端点不验 token，认人靠帧里的 `id`），挂着的那次提交就原地返回了。
 *
 * 两边都要挡总开关：中继有 `disabled`，这边在执行前再读一次——用户刚关掉的那一下，
 * 已经在流上的动作也拿不到执行。
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

export type ActionContext = {
  /** 动作现读总开关：关着不执行、不回传（中继侧另有 `disabled` 挡着）。 */
  readonly enabled: boolean;
  readonly tabs: TabsApi;
  /** target 标签页的执行口：还没有能在页面里执行的动作时留空。 */
  readonly sendToTab?: (tabId: number, frame: ActionFrame) => Promise<ActionOutcome | null>;
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
 * 一件动作 → 要不要回传、回传什么。
 *
 * 返回 `null` = **不回传**：开关关着（不执行）、动作还没实现、target 认不出来——
 * 中继那边等满预算按 `timeout` 收场，比回一个假结果诚实。
 */
export async function runAction(
  frame: ActionFrame,
  context: ActionContext,
): Promise<ActionOutcome | null> {
  if (!context.enabled) return null;
  if (frame.target !== null) {
    const tabId = Number(frame.target);
    if (!Number.isInteger(tabId) || context.sendToTab === undefined) return null;
    return context.sendToTab(tabId, frame);
  }
  if (frame.action === "tabs.list") {
    return { ok: true, result: { tabs: await listSessionTabs(context.tabs) } };
  }
  return null; // 其余只读动作还没实现
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
