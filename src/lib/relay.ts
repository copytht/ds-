/**
 * 中继的调用契约（#11）：`POST /ask`，成功与失败一律 HTTP 200，
 * 载荷是 `{"status":"ok","answer"}` 或 `{"status":"error","error"}`。
 *
 * 端点与请求体在这儿定死（扩展没有输入面，端口只认 dsb 的默认值）；
 * 响应 → 载荷的映射是纯函数，网络层的失败由调用方折成同样的载荷形状。
 */

import { errorPayload, okPayload, type ReplyPayload } from "./reply";

/** 中继是本机服务，端口走 dsb 的默认值 `DSB_PORT` 改不了扩展侧（无输入面）。 */
export const RELAY_ORIGIN = "http://127.0.0.1:8787";
export const RELAY_ASK_PATH = "/ask";
export const RELAY_HEALTH_PATH = "/health";

/**
 * 扩展侧自己掐表的超时，必须宽过 dsb 的**总和**（排队 600s + 答复 140s = 740s），
 * 先到的永远应该是中继——它能把超时折成 `opencode-timeout` 这个有意义的错误码，
 * 扩展这边只能报一句「中继没响应」。留 20s 余量。
 */
export const RELAY_TIMEOUT_MS = 760_000;
/** 探活（`GET /health`）只问在不在，快点回来。 */
export const RELAY_HEALTH_TIMEOUT_MS = 5_000;

/** 网络层失败（没起、被拦、超时）折成的载荷：中继没有响应。 */
export const FAILURE_RELAY_UNREACHABLE = "relay-unreachable";
/** 非 2xx、认不出的响应体：中继响应异常。 */
export const FAILURE_UNEXPECTED_RESPONSE = "unexpected-response";

export function relayAskUrl(): string {
  return `${RELAY_ORIGIN}${RELAY_ASK_PATH}`;
}

export function relayHealthUrl(): string {
  return `${RELAY_ORIGIN}${RELAY_HEALTH_PATH}`;
}

/** 问题进中继的请求体：只有 `question` 一条，逐字符原样送过去。 */
export function relayAskBody(question: string): string {
  return JSON.stringify({ question });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 中继的响应 → 回灌载荷（成功失败同构，解析只有一条路径）。
 * 状态码或载荷不合线协议，一律落 `unexpected-response`，不猜。
 */
export function parseRelayResponse(status: number, bodyText: string): ReplyPayload {
  if (status < 200 || status >= 300) return errorPayload(FAILURE_UNEXPECTED_RESPONSE);

  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return errorPayload(FAILURE_UNEXPECTED_RESPONSE);
  }
  if (!isPlainObject(parsed)) return errorPayload(FAILURE_UNEXPECTED_RESPONSE);

  const relayStatus = parsed["status"];
  if (relayStatus === "ok") {
    const answer = parsed["answer"];
    if (typeof answer === "string" && answer.trim() !== "") return okPayload(answer);
    return errorPayload(FAILURE_UNEXPECTED_RESPONSE);
  }
  if (relayStatus === "error") {
    const error = parsed["error"];
    if (typeof error === "string" && error.trim() !== "") return errorPayload(error);
    return errorPayload(FAILURE_UNEXPECTED_RESPONSE);
  }
  return errorPayload(FAILURE_UNEXPECTED_RESPONSE);
}
