/**
 * 回灌链的信封：问题与结果在页面世界、隔离世界、background 三处之间怎么走。
 *
 * 页面世界看得到模型的回答但碰不到 `storage` 与扩展 API，background 打中继却看不到页面，
 * 中间隔着隔离世界那一层；三段路各认各的信封，形状不对的一律不猜（返回 null）。
 *
 * - `question` / `result`：页面世界 ↔ 隔离世界，走 `window.postMessage`；
 * - `ask` 请求 / 响应：隔离世界 ↔ background，走 `browser.runtime`。
 */

import { FAILURE_RELAY_UNREACHABLE } from "./relay";
import { errorPayload, type ReplyPayload } from "./reply";

/** 页面世界与隔离世界共用的信封标记；认不出这个标记的一概不收。 */
export const CHAIN_MESSAGE_SOURCE = "ds-/chain";
/** background 那条路的信封标记。 */
export const ASK_MESSAGE_TYPE = "ds-/ask";

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
};

export type AskResponse = {
  readonly id: string;
  readonly payload: ReplyPayload;
};

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

export function askRequestMessage(id: string, question: string): AskRequest {
  return { type: ASK_MESSAGE_TYPE, id, question };
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
  return askRequestMessage(id, question);
}

/** 认 background → 隔离世界的响应；响应丢了按中继没响应兜底交给调用方。 */
export function parseAskResponse(data: unknown): AskResponse | null {
  if (!isPlainObject(data)) return null;
  const id = data["id"];
  const payload = data["payload"];
  if (!isValidId(id) || !isReplyPayload(payload)) return null;
  return askResponseMessage(id, payload);
}

/** background 没答上来时的兜底载荷：中继没有响应（同样不进对话流）。 */
export function unreachableResult(id: string): ResultMessage {
  return resultMessage(id, errorPayload(FAILURE_RELAY_UNREACHABLE));
}
