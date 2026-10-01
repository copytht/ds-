/**
 * 回灌链的信封：问题与结果在页面世界、隔离世界、background 三处之间怎么走。
 *
 * 页面世界看得到模型的回答但碰不到 `storage` 与扩展 API，background 打中继却看不到页面，
 * 中间隔着隔离世界那一层；三段路各认各的信封，形状不对的一律不猜（返回 null）。
 *
 * - `question` / `result`：页面世界 ↔ 隔离世界，走 `window.postMessage`；
 * - `ask` 请求 / 响应：隔离世界 ↔ background，走 `browser.runtime`；
 * - `action` 请求与执行结果：background ↔ 内容脚本，走 `browser.tabs.sendMessage`，
 *   认不出的信封一声不吭（`actionListener` 返回 undefined），不抢 ask 那条路的消息。
 */

import { ACTION_ERROR_TAB_GONE, ACTION_ERROR_UNKNOWN, type ActionOutcome } from "./action";
import type { ActionFrame } from "./actionstream";
import { FAILURE_RELAY_UNREACHABLE } from "./relay";
import { errorPayload, type ReplyPayload } from "./reply";

/** 页面世界与隔离世界共用的信封标记；认不出这个标记的一概不收。 */
export const CHAIN_MESSAGE_SOURCE = "ds-/chain";
/** background 那条路的信封标记。 */
export const ASK_MESSAGE_TYPE = "ds-/ask";
/** background → 内容脚本的动作信封标记（照 ask 的套路，各认各的 type）。 */
export const ACTION_MESSAGE_TYPE = "ds-/action";

export type QuestionMessage = {
  readonly source: typeof CHAIN_MESSAGE_SOURCE;
  readonly kind: "question";
  readonly id: string;
  readonly question: string;
};

export type ResultMessage = {
  readonly source: typeof CHAIN_MESSAGE_SOURCE;
  readonly kind: "result";
  readonly id: string;
  readonly payload: ReplyPayload;
};

export type ChainMessage = QuestionMessage | ResultMessage;

export type AskRequest = {
  readonly type: typeof ASK_MESSAGE_TYPE;
  readonly id: string;
  readonly question: string;
  /** 页面会话 id（`/a/chat/s/<id>` 里那段）；认不出是 null，中继落到默认那一份（ADR-0005）。 */
  readonly page: string | null;
};

export type AskResponse = {
  readonly id: string;
  readonly payload: ReplyPayload;
};

/** background → 内容脚本的一件动作：动作帧裹一层 `ds-/action`。 */
export type ActionRequest = {
  readonly type: typeof ACTION_MESSAGE_TYPE;
  readonly frame: ActionFrame;
};

/**
 * 内容脚本的本地名册：动作名 → 执行器。本轮空着（页面里的只读动作还没实现），
 * 实现第一个就往里加一项——认不出的动作由收信那层当场回 `unknown-action`。
 */
export type ActionRoster = Readonly<Record<string, (frame: ActionFrame) => unknown>>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 载荷必须是 status + answer/error 的同构形状，认不出的信封整个作废。 */
export function isReplyPayload(value: unknown): value is ReplyPayload {
  if (!isPlainObject(value)) return false;
  if (value["status"] === "ok") return typeof value["answer"] === "string";
  if (value["status"] === "error") return typeof value["error"] === "string";
  return false;
}

export function questionMessage(id: string, question: string): QuestionMessage {
  return { source: CHAIN_MESSAGE_SOURCE, kind: "question", id, question };
}

export function resultMessage(id: string, payload: ReplyPayload): ResultMessage {
  return { source: CHAIN_MESSAGE_SOURCE, kind: "result", id, payload };
}

/**
 * 从页面地址里抠出页面会话 id（/a/chat/s/<id> 里那段）；认不出返回 null。
 * 中继按它分表：每条页面会话各自一个子会话、各自的锁（ADR-0005）。
 */
export function pageSessionIdOf(url: string): string | null {
  const match = /\/a\/chat\/s\/([^/?#]+)/.exec(url);
  return match?.[1] ?? null;
}

export function askRequestMessage(
  id: string,
  question: string,
  page: string | null = null,
): AskRequest {
  return { type: ASK_MESSAGE_TYPE, id, question, page };
}

export function askResponseMessage(id: string, payload: ReplyPayload): AskResponse {
  return { id, payload };
}

function isValidId(id: unknown): id is string {
  return typeof id === "string" && id !== "";
}

function isValidQuestion(question: unknown): question is string {
  return typeof question === "string" && question.trim() !== "";
}

/** 认页面世界 ↔ 隔离世界的信封：标记、字段、载荷都对上才收。 */
export function parseChainMessage(data: unknown): ChainMessage | null {
  if (!isPlainObject(data)) return null;
  if (data["source"] !== CHAIN_MESSAGE_SOURCE) return null;
  const id = data["id"];
  if (!isValidId(id)) return null;

  if (data["kind"] === "question") {
    const question = data["question"];
    if (!isValidQuestion(question)) return null;
    return questionMessage(id, question);
  }
  if (data["kind"] === "result") {
    const payload = data["payload"];
    if (!isReplyPayload(payload)) return null;
    return resultMessage(id, payload);
  }
  return null;
}

/** 认隔离世界 → background 的请求。 */
export function parseAskRequest(data: unknown): AskRequest | null {
  if (!isPlainObject(data)) return null;
  if (data["type"] !== ASK_MESSAGE_TYPE) return null;
  const id = data["id"];
  const question = data["question"];
  if (!isValidId(id) || !isValidQuestion(question)) return null;
  const raw = data["page"];
  if (raw !== undefined && raw !== null && (typeof raw !== "string" || raw === "")) {
    return null;
  }
  return askRequestMessage(id, question, typeof raw === "string" ? raw : null);
}

/** 认 background → 隔离世界的响应；响应丢了按中继没响应兜底交给调用方。 */
export function parseAskResponse(data: unknown): AskResponse | null {
  if (!isPlainObject(data)) return null;
  const id = data["id"];
  const payload = data["payload"];
  if (!isValidId(id) || !isReplyPayload(payload)) return null;
  return askResponseMessage(id, payload);
}

/** background → 内容脚本：一件动作裹一层信封（照 ask 的套路，各认各的 type）。 */
export function actionRequestMessage(frame: ActionFrame): ActionRequest {
  return { type: ACTION_MESSAGE_TYPE, frame };
}

/**
 * 认动作信封：type 对得上、帧的字段都合线协议才收。
 * id / action 必须非空字符串，target 是字符串或 null，params 是对象（缺省当空，
 * 与 dsb 的 `parse_action_request` 一个脾气）——认不出就 null，收信那层因此不响应。
 */
export function parseActionRequest(data: unknown): ActionRequest | null {
  if (!isPlainObject(data)) return null;
  if (data["type"] !== ACTION_MESSAGE_TYPE) return null;
  const value = data["frame"];
  if (!isPlainObject(value)) return null;
  if (value["type"] !== "action") return null;
  const id = value["id"];
  const action = value["action"];
  if (!isValidId(id) || !isValidId(action)) return null;
  const target = value["target"];
  if (target !== null && typeof target !== "string") return null;
  const params = value["params"] ?? {};
  if (!isPlainObject(params)) return null;
  return actionRequestMessage({ type: "action", id, action, params, target });
}

/**
 * 内容脚本收动作：认得出的动作帧当场回一个 `ActionOutcome`（同步返回 `true` 保住
 * sendResponse 的通道，结果异步交回），认不出的消息返回 `undefined` 一声不吭——
 * ask 那条路的信封也在这条 runtime 通道上，不能抢。
 *
 * 执行器在本地名册里查：没有就当场回 `unknown-action`，不让 background 白等 30s。
 */
export function actionListener(
  roster: ActionRoster,
): (
  message: unknown,
  sender: unknown,
  sendResponse: (outcome: ActionOutcome) => void,
) => true | undefined {
  return (message, _sender, sendResponse) => {
    const request = parseActionRequest(message);
    if (request === null) return undefined;
    // 执行器抛错也要回话：只挂 onFulfilled，一旦 handler reject，sendResponse 永不调用，
    // port 一直挂着直到被 GC，background 那边又变回等满 timeout。
    void executeRoster(request.frame, roster).then(sendResponse, () =>
      sendResponse({ ok: false, error: ACTION_ERROR_TAB_GONE }),
    );
    return true;
  };
}

async function executeRoster(frame: ActionFrame, roster: ActionRoster): Promise<ActionOutcome> {
  // hasOwn 而不是下标直取：名册是普通对象，`"toString"` 这种键会捞到原型上的东西。
  const handler = Object.prototype.hasOwnProperty.call(roster, frame.action)
    ? roster[frame.action]
    : undefined;
  if (handler === undefined) return { ok: false, error: ACTION_ERROR_UNKNOWN };
  return { ok: true, result: await handler(frame) };
}

/** background 没答上来时的兜底载荷：中继没有响应（同样不进对话流）。 */
export function unreachableResult(id: string): ResultMessage {
  return resultMessage(id, errorPayload(FAILURE_RELAY_UNREACHABLE));
}
