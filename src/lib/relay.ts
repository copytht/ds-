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
/** 等待期的现场（只读）：中继在问句在途时把「走到哪一步了」放在这儿。 */
export const RELAY_STATUS_PATH = "/status";

/**
 * 扩展侧自己掐表的超时，只当「中继真死了」的兜底。先到的必须是中继：它保证在自己的
 * 两段预算内回 `opencode-timeout`（开工 120s + 写完 240s = 360s），那是个有信息量的
 * 错误码；扩展一旦先 abort，报出来的只有没信息量的「中继不可达」，还会白扔掉一次
 * 正在跑的调用。所以这个值要宽过中继最坏时长一个 HTTP 往返的量级。
 *
 * 两个数分处 TS 与 Python 两套代码，靠 `relay.test.ts` 的跨语言断言对齐，别只改一边。
 */
export const RELAY_TIMEOUT_MS = 480_000;
/** 探活（`GET /health`）只问在不在，快点回来。 */
export const RELAY_HEALTH_TIMEOUT_MS = 5_000;
/**
 * 现场快照（`GET /status`）同样只要个「在不在 + 走到哪一步」，跟探活一样快。
 *
 * 中继一挂，这一条会在自己的超时内报错——所以「等着的时候中继死了」不用另外
 * 定一条静默判死的规矩：**每 3s 一问，问不到当场就红**，比攒到 30s 快得多。
 */
export const RELAY_STATUS_TIMEOUT_MS = 5_000;
/** 等待期问现场的节奏。3s 足够看出进展，又不至于把 service worker 叫醒个不停。 */
export const RELAY_STATUS_POLL_INTERVAL_MS = 3_000;

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

export function relayStatusUrl(): string {
  return `${RELAY_ORIGIN}${RELAY_STATUS_PATH}`;
}

/** 等待期的四个阶段，与 dsb 侧 `AskProgress` 的取值一一对应。 */
export const ASK_PHASES = ["queued", "running", "writing", "done"] as const;
export type AskPhase = (typeof ASK_PHASES)[number];

export type AskStatus = {
  readonly phase: AskPhase;
  /** 已经吐出来的正文字数——只数自己 spawn 的那个子会话。 */
  readonly written: number;
  /** 这一段预算还剩多少秒；`null` = 中继还没定下该用哪一段。 */
  readonly remaining: number | null;
};

/**
 * 一次现场快照。`reachable` 只回答「这条响应能不能信」——答不上来一律不信，
 * 宁可让图标翻红也不猜（跟 `parseRelayResponse` 一个脾气）。
 */
export type StatusSnapshot = {
  readonly reachable: boolean;
  readonly ask: AskStatus | null;
};

/** 中继没答上来的唯一样子。 */
const STATUS_OFFLINE: StatusSnapshot = { reachable: false, ask: null };

function parseAskStatus(value: unknown): AskStatus | null {
  if (!isPlainObject(value)) return null;
  const phase = value["phase"];
  const written = value["written"];
  const remaining = value["remaining"];
  if (typeof phase !== "string" || !ASK_PHASES.includes(phase as AskPhase)) return null;
  if (typeof written !== "number" || !Number.isFinite(written) || written < 0) return null;
  // remaining 必须在场：要么是 null（还没定下用哪一段），要么是个有限秒数。
  if (remaining === null) return { phase: phase as AskPhase, written, remaining: null };
  if (typeof remaining !== "number" || !Number.isFinite(remaining)) return null;
  return { phase: phase as AskPhase, written, remaining };
}

/**
 * `GET /status` 的响应 → 现场快照。
 *
 * 非 2xx、不是 JSON、`status` 不是 ok、`ask` 长得不对，一律落 `STATUS_OFFLINE`：
 * 快照是拿去上屏的，报一个看不懂的值不如报「这条不可信」。
 */
export function parseStatusResponse(status: number, bodyText: string): StatusSnapshot {
  if (status < 200 || status >= 300) return STATUS_OFFLINE;

  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return STATUS_OFFLINE;
  }
  if (!isPlainObject(parsed) || parsed["status"] !== "ok") return STATUS_OFFLINE;

  const ask = parsed["ask"];
  if (ask === null) return { reachable: true, ask: null }; // 空档：中继在，只是没问句在途
  const askStatus = parseAskStatus(ask);
  return askStatus === null ? STATUS_OFFLINE : { reachable: true, ask: askStatus };
}
