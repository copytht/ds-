/**
 * 本地工具：名字在扩展自己的一张名册里、**执行不经过 dsb** 的围栏工具。
 *
 * 为什么在扩展侧：dsb 是被动 MCP 网关（ADR-0011）——只能被调，不能反过来
 * 指挥扩展干活；dsb→扩展 的反向通道已废。所以「组合」只能住扩展侧：网页
 * 模型在围栏里排本地工具名时，background 就地执行（`sendCall` 截获，
 * 不把这一条转发 dsb）。
 *
 * v1 只有 `send.page` 一件：往页面发一个问题 → 等页面模型排围栏 → 等回灌
 * → 返回答复正文。四步全走 `runAction`，总开关 / 替人发言 / 退避三道闸
 * 照拦；失败码全取现成册子，不新增。
 */

import {
  ACTION_ERROR_PAGE_CHANGED,
  ACTION_ERROR_TAB_GONE,
  ACTION_ERROR_UNKNOWN,
  type ActionOutcome,
} from "./action";
import { errorPayload, parseReplyPayload, type ReplyPayload } from "./reply";
import { DEFAULT_WAIT_SECONDS, MAX_WAIT_SECONDS, MIN_WAIT_SECONDS } from "./wait";

/** 本地工具执行时由调用方（background）注入的环境。 */
export type LocalToolEnv = {
  /** 围栏来自哪个标签页；消息不带 tab 时 undefined（组合当场回 `tab-gone`）。 */
  readonly tabId: number | undefined;
  /** 送一件页面动作进页面：background 包好 `runAction` 与 `target` 的口。 */
  readonly run: (action: string, params: Record<string, unknown>) => Promise<ActionOutcome>;
};

/** 名册里的一件本地工具：名字 / 说明 / 参数（进协议说明）+ 执行体。 */
export type LocalTool = {
  readonly name: string;
  readonly description: string;
  readonly params: readonly string[];
  readonly run: (args: Record<string, unknown>, env: LocalToolEnv) => Promise<ReplyPayload>;
};

/**
 * 等待预算：`seconds` 可配，非法按默认，钳在 [1, 25]——与 `wait.ts` 的
 * `parseWaitSeconds` 同一口径（这边先归一，再交给 `wait.fence`/`wait.reply`）。
 */
export function normalizeSeconds(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(Math.max(value, MIN_WAIT_SECONDS), MAX_WAIT_SECONDS)
    : DEFAULT_WAIT_SECONDS;
}

/** 组合的四步：动作名 + 入参，顺序即执行顺序。 */
function sendPageSteps(
  question: string,
  seconds: number,
): readonly (readonly [string, Record<string, unknown>])[] {
  return [
    ["composer.type", { text: question }],
    ["send.enter", {}],
    ["wait.fence", { timeout: seconds }],
    ["wait.reply", { timeout: seconds }],
  ];
}

/** 从 `wait.reply` 的结果里取回灌原文（`{text}`，首行锚为 `agent:`）。 */
function replyTextOf(outcome: ActionOutcome): string | null {
  if (!outcome.ok) return null;
  const result = outcome.result;
  if (typeof result !== "object" || result === null) return null;
  const text = (result as Record<string, unknown>)["text"];
  return typeof text === "string" ? text : null;
}

const SEND_PAGE: LocalTool = {
  name: "send.page",
  description: "往页面发一个问题，等页面模型排围栏、等回灌，返回答复正文。",
  params: ["question", "seconds?"],
  async run(args, env) {
    if (env.tabId === undefined) return errorPayload(ACTION_ERROR_TAB_GONE);
    const question = args["question"];
    if (typeof question !== "string" || question.trim() === "") {
      // 排得不成形：与围栏里 JSON 排坏同一处置（不猜、当场说）。
      return errorPayload(ACTION_ERROR_UNKNOWN);
    }
    const seconds = normalizeSeconds(args["seconds"]);
    // 四步依次走；任一步没成就原码回，**不再往下**（前半句没成就不发后半句）。
    let last: ActionOutcome | null = null;
    for (const [action, params] of sendPageSteps(question, seconds)) {
      last = await env.run(action, params);
      if (!last.ok) return errorPayload(last.error);
    }
    // 最后一步是 `wait.reply`：把回灌解回载荷再交回去（解不出就回页面变样了）。
    const text = last === null ? null : replyTextOf(last);
    if (text === null) return errorPayload(ACTION_ERROR_PAGE_CHANGED);
    return parseReplyPayload(text) ?? errorPayload(ACTION_ERROR_PAGE_CHANGED);
  },
};

/** 本地工具名册（v1 只有组合 `send.page`）。 */
export const LOCAL_TOOLS: readonly LocalTool[] = [SEND_PAGE];

/** 按名字找一件本地工具；不是本地的一律 null（调用方照旧转发 dsb）。 */
export function findLocalTool(name: string): LocalTool | null {
  return LOCAL_TOOLS.find((tool) => tool.name === name) ?? null;
}
