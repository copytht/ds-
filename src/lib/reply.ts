/**
 * 回灌组装与失败提示（agent → 页面的线协议）。
 *
 * 回灌消息首行固定 `agent:`（首行锚），其后是 TOON 载荷；
 * 载荷只有两个同构分支：status: ok + answer、status: error + error。
 * 失败提示只出现在扩展侧，不进对话流。
 */

import { encode } from "@toon-format/toon";

/** 回灌消息的首行锚。 */
export const REPLY_ANCHOR = "agent:";

/**
 * 这段文本是不是一条回灌消息：第一行就是首行锚。
 * 回灌要当真实用户消息发出去，协议说明不能插到它前面——首行锚必须留在第一行。
 */
export function hasReplyAnchor(text: string): boolean {
  return text.split("\n")[0] === REPLY_ANCHOR;
}

/** 工具栏图标点击后给出的启动命令。 */
export const RELAY_START_COMMAND = "uv run dsb";

export type OkPayload = { readonly status: "ok"; readonly answer: string };
export type ErrorPayload = { readonly status: "error"; readonly error: string };
export type ReplyPayload = OkPayload | ErrorPayload;

export function okPayload(answer: string): OkPayload {
  return { status: "ok", answer };
}

export function errorPayload(code: string): ErrorPayload {
  return { status: "error", error: code };
}

/**
 * 组装一条回灌消息：首行锚 + TOON 载荷（TOON 编码只发生在这里）。
 *
 * 多行正文走 TOON 的 tabular form（SPEC §9.3）——一行正文一条 row：
 *
 *     agent:
 *     status: ok
 *     answer[2]{text}:
 *       第一行
 *       第二行
 *
 * 不能编码成裸字符串：SPEC §7.1 规定字符串里的 LF MUST 转义成 `\n`，而解码方是
 * 网页上的 LLM、不是解析器，实测它不会还原（真机：回灌里满屏字面 `\n`，内容没错
 * 但格式全毁）。tabular 让换行等于物理行，转义无从发生；SPEC §7.2 的加引号规则
 * 再把会冒充结构的正文行（`agent:`、`status: …`、`answer[N]: …`、`- …`、`# …`）
 * 封起来，所以正文里没有歧义边界。
 */
export function buildReply(payload: ReplyPayload): string {
  if (payload.status === "ok") {
    const answer = payload.answer.split("\n").map((text) => ({ text }));
    return `${REPLY_ANCHOR}\n${encode({ status: "ok", answer })}`;
  }
  return `${REPLY_ANCHOR}\n${encode(payload)}`;
}

/** 失败不进对话流：只有 status: ok 的载荷才会被回灌进页面。 */
export function isInjectableReply(payload: ReplyPayload): boolean {
  return payload.status === "ok";
}

/** 扩展侧失败提示能显示的原因；dsb 吐出的每个错误码都必须在册。 */
export type FailureKind =
  "relay-unreachable" | "opencode-not-running" | "opencode-timeout" | "unexpected-response";

export type FailureNotice = {
  /** 工具栏图标的悬停标题。 */
  readonly title: string;
  /** 悬停给出的原因。 */
  readonly reason: string;
  /** 点击图标后给出的启动命令。 */
  readonly command: string;
};

const NOTICES: Record<FailureKind, FailureNotice> = {
  "relay-unreachable": {
    title: "中继不可达",
    reason: "本机中继 dsb 没有响应。",
    command: RELAY_START_COMMAND,
  },
  "opencode-not-running": {
    title: "中继不可达",
    reason: "opencode 后台服务没有运行。",
    command: RELAY_START_COMMAND,
  },
  "opencode-timeout": {
    title: "中继超时",
    reason: "opencode 没有在超时前给出答复。",
    command: RELAY_START_COMMAND,
  },
  "unexpected-response": {
    title: "中继响应异常",
    reason: "中继返回了无法识别的响应。",
    command: RELAY_START_COMMAND,
  },
};

export function isKnownFailureKind(kind: string): kind is FailureKind {
  return Object.hasOwn(NOTICES, kind);
}

/** 扩展侧失败提示：没问成时扩展自己给出的提示，不进对话流。 */
export function failureNotice(kind: string): FailureNotice {
  if (isKnownFailureKind(kind)) return NOTICES[kind];
  return {
    title: "中继不可达",
    reason: `无法识别的原因（${kind}）`,
    command: RELAY_START_COMMAND,
  };
}
