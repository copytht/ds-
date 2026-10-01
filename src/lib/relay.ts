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
 * 扩展侧自己掐表的超时，只当「中继真死了」的兜底。先到的必须是中继：中继按**静默**计时
 * （`DSB_IDLE_TIMEOUT`，默认 240s 没动静才判；opencode 在动就一直等），只在硬顶
 * `DSB_MAX_TIMEOUT`（默认 1800s）上兜底——那时它回一个 `opencode-timeout`，是个有信息量
 * 的错误码；扩展一旦先 abort，报出来的只有没信息量的「中继不可达」，还会白扔掉一次正在跑
 * 的调用。所以这个值要宽过中继的硬顶一个 HTTP 往返的量级。
 *
 * 两个数分处 TS 与 Python 两套代码，没有共同的运行时事实来源，只能靠跨语言断言对齐：
 * `tests/test_relay_server.py` 直接读这一行的字面量。别只改一边。
 */
export const RELAY_TIMEOUT_MS = 1_920_000;
/** 探活（`GET /health`）只问在不在，快点回来。 */
export const RELAY_HEALTH_TIMEOUT_MS = 5_000;
/**
 * 一趟轮询最多挂多久。中继那侧最多让请求挂 15s（没出结果就回 `pending`），这里宽一点，
 * 免得网络抖动把一趟正常轮询掐了。
 */
export const RELAY_POLL_TIMEOUT_MS = 20_000;
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

/**
 * 问题进中继的请求体：问题逐字符原样送，另带一个**轮询 id**。
 *
 * 带 id 是为了把一趟长问句拆成几趟短 fetch：MV3 的 service worker 对一条在途 fetch 只保它
 * 约 5 分钟，更长的问句一过线就被浏览器连人带连接一起收走——中继算完了也写不回来（真机日志
 * 里两次 `BrokenPipe`）。带同一个 id 接着问，中继把结果交出来。
 */
export function relayAskBody(question: string, id: string, page: string | null = null): string {
  return page === null ? JSON.stringify({ question, id }) : JSON.stringify({ question, id, page });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 一趟轮询的回法：还没出结果（`pending`）或最终载荷。扩展拿 `pending` 就带同一个 id 再问。
 */
export type RelayAskPoll = ReplyPayload | { readonly status: "pending" };

/**
 * 中继的响应 → 回灌载荷（成功失败同构，解析只有一条路径）。
 * 状态码或载荷不合线协议，一律落 `unexpected-response`，不猜。
 */
export function parseRelayResponse(status: number, bodyText: string): RelayAskPoll {
  if (status < 200 || status >= 300) return errorPayload(FAILURE_UNEXPECTED_RESPONSE);

  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return errorPayload(FAILURE_UNEXPECTED_RESPONSE);
  }
  if (!isPlainObject(parsed)) return errorPayload(FAILURE_UNEXPECTED_RESPONSE);

  const relayStatus = parsed["status"];
  if (relayStatus === "pending") return { status: "pending" };
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
  /** 静默窗口还剩多少秒（也受硬顶约束）；`null` = 还没落定（排队时）。 */
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

/**
 * 网络层的异常 → 一句能进日志、能上悬停的话。
 *
 * `fetch` 抛出来的东西分两种：自己掐表的 `AbortError`（「5 秒没回」是**有信息量**的，
 * 中继活着但卡住了）和 `TypeError`（连都没连上）。两者排查方向相反，别都折成一个
 * 「失败」了事——之前就是这么吞掉的，结果翻红之后没人说得出为什么。
 */
export function describeFetchFailure(error: unknown, timeoutMs: number): string {
  if (error instanceof DOMException && error.name === "AbortError") {
    return `超时（${timeoutMs}ms 没回）`;
  }
  return "连接失败";
}

/**
 * 响应到了、但读不出体面的现场 → 一句话。
 *
 * 状态码能报就报码；2xx 却解析不出来，说明中继答了个看不懂的东西，这时正文规模是
 * 唯一有用的事实（几十个字和空响应不是一回事），**不记正文本身**。
 */
export function describeStatusFailure(status: number, bodyText: string): string {
  if (status < 200 || status >= 300) return `HTTP ${status}`;
  return `响应读不出来（${bodyText.length} 字）`;
}
