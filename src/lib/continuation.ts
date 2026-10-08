/**
 * 续聊的组装：**短标记进对话，工具结果走出站请求体**。
 *
 * 原来一次工具调用就是一条 `agent:` 开头的长用户消息（TOON 正文全文进对话历史），
 * 一轮一条——会话里全是机器痕迹，而且这条消息是扩展**自己发**的。
 * 参考项目 WebTool-DeepSeek 的做法是：往输入框填一个**短标记**（「继续」）发出去，
 * 真正给模型看的正文由 main world 在出站请求体里**替换**掉
 * （`core/interceptor/fetch-hook.ts` 的 `pendingContinuationPrompt`）。
 * 于是对话里只多一个短气泡，工具结果不进可见流。
 *
 * 这里只管「短标记长什么样」与「给模型的正文长什么样」：替换请求体在
 * `inject.ts`（`rewriteContinuationBody`），轮数刹车在 `rounds.ts`。
 * 载荷形状与 TOON 编码仍归 `reply.ts`——正文还是那一段，只是换了条路走。
 */

import { buildReply, type OkPayload } from "./reply";

/**
 * 对话里那个短标记：**首行仍是首行锚**（`agent:` 恰好占第一行，页面侧据此认出
 * 「这条是桥发的」——`wait.reply` 与 `prependOnce` 都读它），第二行才是那个词。
 * 两行高度，比起原来那条 TOON 全文的消息，会话里就只剩这么一点痕迹。
 */
export const CONTINUATION_MARKER = "agent:\n继续";

/** 给模型的工具结果正文上限（字符）。参考项目是 `detail.slice(0, 2000)`。 */
export const MAX_RESULT_CHARS = 2000;

/**
 * 截断一段工具结果正文。超了在尾巴上留一句「已截断」，并写明原长——
 * 让模型知道它看到的不是全文，它会据此改问法，而不是拿半截正文当全貌。
 */
export function truncateResult(text: string, max: number = MAX_RESULT_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…（工具结果已截断：原文 ${text.length} 字，这里是前 ${max} 字）`;
}

/** 续聊正文 = 原来的回灌载荷（`agent:` 锚 + TOON），截断之后改走请求体。 */
export function buildContinuation(payload: OkPayload, max: number = MAX_RESULT_CHARS): string {
  return buildReply({ status: "ok", answer: truncateResult(payload.answer, max) });
}

/**
 * 这一刻武装还算不算数（期限由调用方给）。
 *
 * 期限本身归状态机所有（`armed.ts` 的 `ARMED_TTL_MS`）：#49 之后**它不再承担安全
 * 职责**——替换只看「这条出站请求的正文逐字等于短标记」那把钥匙，用户手打的话永远
 * 不会等于标记，与等多久无关。期限只是别让悬挂态挂太久。
 */
export function isArmedFresh(armedAt: number, now: number, ttlMs: number): boolean {
  return now - armedAt <= ttlMs;
}

/** 停手原因的码：进上报（跨三层），人话进悬停。 */
export const STOP_CONTINUATION_LIMIT = "continuation-limit";

/** 停手原因 → 一句能直接进悬停的话（留痕的 `cause`）。 */
export function describeStop(cause: string): string {
  if (cause === STOP_CONTINUATION_LIMIT) {
    return `自动续聊连到上限，停手等用户开口`;
  }
  return `页面报停手（${cause}）`;
}
