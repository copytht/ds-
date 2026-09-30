import { describe, expect, it } from "vitest";

import {
  ACTION_STREAM_URL,
  createActionStream,
  parseSseLine,
  type ActionFrame,
  type ByteStream,
} from "./actionstream";

const encoder = new TextEncoder();

/** 假 SSE 流：往里塞字符串、随手关掉，读的一侧按需吐字节。 */
function controllableStream() {
  const queue: Array<{ value?: Uint8Array; done: boolean }> = [];
  const waiters: Array<(chunk: { value?: Uint8Array; done: boolean }) => void> = [];
  const flush = () => {
    while (waiters.length > 0 && queue.length > 0) waiters.shift()!(queue.shift()!);
  };
  const stream: ByteStream = {
    getReader: () => ({
      read: () =>
        new Promise((resolve) => {
          waiters.push(resolve);
          flush();
        }),
    }),
  };
  return {
    stream,
    push(text: string): void {
      queue.push({ value: encoder.encode(text), done: false });
      flush();
    },
    close(): void {
      queue.push({ done: true });
      flush();
    },
  };
}

/** 拿确定下标上的元素（`noUncheckedIndexedAccess` 下下标可能 undefined）。 */
function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`第 ${index} 个还没到场`);
  return item;
}

async function until(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("等不到预期的现场");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const SUBSCRIBED = 'data: {"type": "subscribed"}\n\n';
const HEARTBEAT = ": heartbeat\n\n";
const ACTION_LINE =
  'data: {"type":"action","id":"1-a","action":"tabs.list","params":{"页":"首页"},"target":null}\n\n';

describe("一行 SSE 的解析（形状照抄中继事件流）", () => {
  it("data 行 → 动作帧，参数原样（含中文）", () => {
    expect(parseSseLine(ACTION_LINE.trim())).toEqual({
      type: "action",
      id: "1-a",
      action: "tabs.list",
      params: { 页: "首页" },
      target: null,
    });
  });

  it("订阅成功与心跳是动静，不算动作", () => {
    expect(parseSseLine('data: {"type":"subscribed"}')).toEqual({ note: "subscribed" });
    expect(parseSseLine(": heartbeat")).toEqual({ note: "heartbeat" });
  });

  it("认不出的一律 null，坏数据不掀桌", () => {
    expect(parseSseLine("event: message")).toBeNull();
    expect(parseSseLine("data: 半截 {json")).toBeNull();
    expect(parseSseLine('data: {"type":"action","id":"","action":"tabs.list"}')).toBeNull();
    expect(parseSseLine(": 只是注释")).toBeNull();
  });
});

describe("动作流订阅", () => {
  it("没开订阅不发起请求；开了才连 /actions", async () => {
    const opened: string[] = [];
    const stream = createActionStream({
      open: async (url) => {
        opened.push(url);
        return controllableStream().stream;
      },
      onFrame: () => undefined,
      reconnectDelayMs: 0,
    });

    expect(stream.state).toBe("closed");
    stream.sync(false); // 关着：不订阅
    expect(opened).toEqual([]);

    stream.sync(true);
    await until(() => opened.length > 0);
    expect(opened[0]).toBe(ACTION_STREAM_URL);
    expect(stream.state).toBe("streaming");
  });

  it("收动作帧 → 路由交给 onFrame；半行分片也接得住", async () => {
    const fake = controllableStream();
    const frames: ActionFrame[] = [];
    const stream = createActionStream({
      open: async () => fake.stream,
      onFrame: (frame) => frames.push(frame),
      reconnectDelayMs: 0,
    });
    stream.sync(true);
    await until(() => stream.state === "streaming");

    const [head, tail] = [ACTION_LINE.slice(0, 20), ACTION_LINE.slice(20)];
    fake.push(SUBSCRIBED);
    fake.push(head);
    await new Promise((resolve) => setTimeout(resolve, 10));
    fake.push(tail);

    await until(() => frames.length > 0);
    expect(frames[0]).toEqual({
      type: "action",
      id: "1-a",
      action: "tabs.list",
      params: { 页: "首页" },
      target: null,
    });
    stream.sync(false);
  });

  it("心跳只报动静，不进动作", async () => {
    const fake = controllableStream();
    const frames: ActionFrame[] = [];
    const notes: string[] = [];
    const stream = createActionStream({
      open: async () => fake.stream,
      onFrame: (frame) => frames.push(frame),
      onNote: (note) => notes.push(note),
      reconnectDelayMs: 0,
    });
    stream.sync(true);
    await until(() => stream.state === "streaming");
    fake.push(HEARTBEAT + SUBSCRIBED);
    await until(() => notes.length === 2);

    expect(notes).toEqual(["heartbeat", "subscribed"]);
    expect(frames).toEqual([]);
    stream.sync(false);
  });

  it("关掉就断开，断开后不重连", async () => {
    const opened: string[] = [];
    const signals: AbortSignal[] = [];
    const fake = controllableStream();
    const stream = createActionStream({
      open: async (url, signal) => {
        opened.push(url);
        signals.push(signal);
        return fake.stream;
      },
      onFrame: () => undefined,
      reconnectDelayMs: 0,
    });

    stream.sync(true);
    await until(() => opened.length === 1);
    stream.sync(false);

    expect(at(signals, 0).aborted).toBe(true);
    expect(stream.state).toBe("closed");
    fake.close(); // 这时候流才收摊——已经摘牌了，不该替它排重连
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(opened).toHaveLength(1);
  });

  it("开着时流断了自己重连；重连后关掉就不再回来", async () => {
    const opened: string[] = [];
    const fakes: ReturnType<typeof controllableStream>[] = [];
    const stream = createActionStream({
      open: async (url) => {
        opened.push(url);
        const fake = controllableStream();
        fakes.push(fake);
        return fake.stream;
      },
      onFrame: () => undefined,
      reconnectDelayMs: 0,
    });

    stream.sync(true);
    await until(() => opened.length === 1);
    at(fakes, 0).close(); // 中继那边断了
    await until(() => fakes.length === 2, 2000); // 还开着 → 重连

    stream.sync(false);
    at(fakes, 1).close();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fakes).toHaveLength(2); // 关着就不回来了
    expect(stream.state).toBe("closed");
  });
});
