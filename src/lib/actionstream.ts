/**
 * 动作流（ADR-0007）的收流侧：`GET /actions` 是 `text/event-stream`，扩展订阅它收页面动作。
 *
 * MV3 的 background service worker 里没有 `EventSource`，只能 `fetch` + `response.body.getReader()`
 * 自己按行解。帧的形状照抄中继的事件流（`data: {json}` 一行一条、`: heartbeat` 注释一拍、
 * 事件之间空行分隔），但这是收流侧的 TS——形状照抄，代码不 import Python。
 *
 * 订阅由总开关掌着：开着才连，关了当场断且不再重连（通道不活着，和「站点范围钉死」一个思路）。
 */

/** 动作流端点：中继本机服务，端口跟 `/send` 一样只认 dsb 的默认值。 */
export const ACTION_STREAM_URL = "http://127.0.0.1:8787/actions";

/** 断开后多久重连：中继重启是常态，别一次失败就永远不回来（关着时不排这个）。 */
export const RECONNECT_DELAY_MS = 1_000;

/** 中继推下来的一件页面动作（与 `protocol/fixtures/action.json` 的请求体同形）。 */
export type ActionFrame = {
  readonly type: "action";
  readonly id: string;
  readonly action: string;
  readonly params: Record<string, unknown>;
  readonly target: string | null;
};

/** 不是动作、但值得知道的流上动静（订阅成功 / 心跳一拍）。 */
export type StreamNote = "subscribed" | "heartbeat";

export type ParsedLine = ActionFrame | { readonly note: StreamNote };

/**
 * 一行 SSE → 事件；认不出的一律 null（半截 JSON、陌生事件当没看见，
 * 别让一行坏数据掀翻整条订阅）。
 */
export function parseSseLine(line: string): ParsedLine | null {
  if (line.startsWith(":")) return line.includes("heartbeat") ? { note: "heartbeat" } : null;
  if (!line.startsWith("data:")) return null;
  const raw = line.slice("data:".length).trim();
  if (raw === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  if (record["type"] === "subscribed") return { note: "subscribed" };
  if (record["type"] !== "action") return null;
  if (typeof record["id"] !== "string" || record["id"] === "") return null;
  if (typeof record["action"] !== "string" || record["action"] === "") return null;
  const target = record["target"];
  if (target !== null && typeof target !== "string") return null;
  const params =
    typeof record["params"] === "object" && record["params"] !== null
      ? (record["params"] as Record<string, unknown>)
      : {};
  return {
    type: "action",
    id: record["id"],
    action: record["action"],
    params,
    target: target ?? null,
  };
}

/**
 * 收流只需要这两下：真 `ReadableStream` 天然满足，测试喂个假的 reader 也满足——
 * 不把 `ReadableStream` 整个类型拽进来（jsdom 里没有它）。
 */
export type ByteStream = {
  getReader(): { read(): Promise<{ readonly value?: Uint8Array; readonly done: boolean }> };
};

export type OpenStream = (url: string, signal: AbortSignal) => Promise<ByteStream>;

export type ActionStreamState = "closed" | "opening" | "streaming";

export type ActionStream = {
  /** 总开关变了就调一次：开 → 订阅；关 → 断开且不再重连。 */
  sync(enabled: boolean): void;
  readonly state: ActionStreamState;
};

export type ActionStreamOptions = {
  readonly open: OpenStream;
  readonly onFrame: (frame: ActionFrame) => void;
  readonly onNote?: (note: StreamNote) => void;
  readonly url?: string;
  readonly reconnectDelayMs?: number;
};

export function createActionStream(options: ActionStreamOptions): ActionStream {
  const url = options.url ?? ACTION_STREAM_URL;
  const delay = options.reconnectDelayMs ?? RECONNECT_DELAY_MS;
  let enabled = false;
  let controller: AbortController | null = null;
  let state: ActionStreamState = "closed";

  function start(): void {
    if (!enabled || controller !== null) return;
    const mine = new AbortController();
    controller = mine;
    state = "opening";
    void pump(mine);
  }

  function consume(line: string): void {
    if (line === "") return; // SSE 事件之间的空行
    const event = parseSseLine(line);
    if (event === null) return;
    if ("note" in event) {
      options.onNote?.(event.note);
      return;
    }
    options.onFrame(event);
  }

  async function pump(mine: AbortController): Promise<void> {
    try {
      const stream = await options.open(url, mine.signal);
      if (mine.signal.aborted) return;
      state = "streaming";
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? ""; // 最后半行留着，下一次 read 拼回去（多字节字符会被劈开）
        for (const rawLine of lines) consume(rawLine.replace(/\r$/, ""));
      }
    } catch {
      // 连不上 / 中继重启 / 读到一半断了：跟正常断开走同一条收摊路
    }
    if (controller !== mine) return; // 已经被 sync(false) 摘牌：那条轮不到它排下一次
    controller = null;
    state = "closed";
    if (enabled) setTimeout(start, delay); // 还开着 → 重连；关着就到此为止
  }

  return {
    sync(next: boolean): void {
      if (next === enabled) return;
      enabled = next;
      if (next) {
        start();
        return;
      }
      state = "closed";
      const mine = controller;
      controller = null; // 先摘牌再断：pump 的 finally 就不会替它排重连
      mine?.abort();
    },
    get state(): ActionStreamState {
      return state;
    },
  };
}
