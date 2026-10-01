import { describe, expect, it, vi } from "vitest";

import {
  actionListener,
  actionRequestMessage,
  ACTION_MESSAGE_TYPE,
  askRequestMessage,
  askResponseMessage,
  CHAIN_MESSAGE_SOURCE,
  isReplyPayload,
  parseActionRequest,
  parseAskRequest,
  parseAskResponse,
  parseChainMessage,
  questionMessage,
  resultMessage,
  unreachableResult,
} from "./channel";
import type { ActionFrame } from "./actionstream";

describe("页面世界 ↔ 隔离世界的信封", () => {
  it("问题信封原样过", () => {
    const message = questionMessage("ask-1", "仓库结构是什么");
    expect(message).toEqual({
      source: CHAIN_MESSAGE_SOURCE,
      kind: "question",
      id: "ask-1",
      question: "仓库结构是什么",
    });
    expect(parseChainMessage(message)).toEqual(message);
  });

  it("结果信封带同构载荷，原样过", () => {
    const message = resultMessage("ask-1", { status: "ok", answer: "答复" });
    expect(parseChainMessage(message)).toEqual(message);

    const failed = resultMessage("ask-1", { status: "error", error: "opencode-timeout" });
    expect(parseChainMessage(failed)).toEqual(failed);
  });

  it("不是我们的标记、形状不对的一律不收", () => {
    expect(parseChainMessage(undefined)).toBeNull();
    expect(parseChainMessage(null)).toBeNull();
    expect(parseChainMessage("ds-/chain")).toBeNull();
    expect(
      parseChainMessage({ source: "page", kind: "question", id: "1", question: "q" }),
    ).toBeNull();
    expect(parseChainMessage({ source: CHAIN_MESSAGE_SOURCE, kind: "ping" })).toBeNull();
    expect(
      parseChainMessage({ source: CHAIN_MESSAGE_SOURCE, kind: "question", id: "", question: "q" }),
    ).toBeNull();
    expect(
      parseChainMessage({
        source: CHAIN_MESSAGE_SOURCE,
        kind: "question",
        id: "ask-1",
        question: "   ",
      }),
    ).toBeNull();
    expect(
      parseChainMessage({ source: CHAIN_MESSAGE_SOURCE, kind: "question", id: "ask-1" }),
    ).toBeNull();
  });

  it("结果信封里的载荷不合线协议就不收", () => {
    expect(
      parseChainMessage({
        source: CHAIN_MESSAGE_SOURCE,
        kind: "result",
        id: "ask-1",
        payload: { status: "ok" },
      }),
    ).toBeNull();
    expect(
      parseChainMessage({
        source: CHAIN_MESSAGE_SOURCE,
        kind: "result",
        id: "ask-1",
        payload: { status: "nope", error: "x" },
      }),
    ).toBeNull();
    expect(
      parseChainMessage({
        source: CHAIN_MESSAGE_SOURCE,
        kind: "result",
        id: "ask-1",
        payload: "agent:\nstatus: ok",
      }),
    ).toBeNull();
  });
});

describe("隔离世界 ↔ background 的信封", () => {
  it("请求与响应原样过", () => {
    const request = askRequestMessage("ask-2", "问题");
    expect(parseAskRequest(request)).toEqual(request);

    const response = askResponseMessage("ask-2", {
      status: "error",
      error: "opencode-not-running",
    });
    expect(parseAskResponse(response)).toEqual(response);
  });

  it("认不出的请求与响应不收", () => {
    expect(parseAskRequest({})).toBeNull();
    expect(parseAskRequest({ type: "ds-/other", id: "1", question: "q" })).toBeNull();
    expect(parseAskRequest({ type: "ds-/ask", id: "1", question: "" })).toBeNull();
    expect(parseAskResponse(undefined)).toBeNull();
    expect(parseAskResponse({ id: "1", payload: { status: "error" } })).toBeNull();
    expect(parseAskResponse({ payload: { status: "ok", answer: "a" } })).toBeNull();
  });

  it("background 没答上来时兜底成中继没响应的载荷", () => {
    const result = unreachableResult("ask-2");
    expect(result.payload).toEqual({ status: "error", error: "relay-unreachable" });
    expect(parseChainMessage(result)).toEqual(result);
  });
});

describe("isReplyPayload · 载荷同构", () => {
  it("ok 只认带 string answer 的", () => {
    expect(isReplyPayload({ status: "ok", answer: "" })).toBe(true);
    expect(isReplyPayload({ status: "ok" })).toBe(false);
    expect(isReplyPayload({ status: "ok", answer: 42 })).toBe(false);
  });

  it("error 只认带 string error 的", () => {
    expect(isReplyPayload({ status: "error", error: "unexpected-response" })).toBe(true);
    expect(isReplyPayload({ status: "error" })).toBe(false);
  });

  it("两条之外的形状都不认", () => {
    expect(isReplyPayload(null)).toBe(false);
    expect(isReplyPayload([])).toBe(false);
    expect(isReplyPayload({ status: "loading" })).toBe(false);
  });
});

/** 一件带 target 的动作帧：background 打包、内容脚本拆包都用它对拍。 */
const ACTION_FRAME: ActionFrame = {
  type: "action",
  id: "7-x",
  action: "page.state",
  params: { x: 1 },
  target: "42",
};

describe("background ↔ 内容脚本的动作信封", () => {
  it("请求原样过，响应是同构载荷", () => {
    const request = actionRequestMessage(ACTION_FRAME);
    expect(request.type).toBe(ACTION_MESSAGE_TYPE);
    expect(parseActionRequest(request)?.frame).toEqual(ACTION_FRAME);
  });

  it("缺字段 / 错 type / 形状不对的一律 null", () => {
    expect(parseActionRequest(undefined)).toBeNull();
    expect(parseActionRequest({ type: "ds-/ask", id: "1", question: "q" })).toBeNull();
    expect(parseActionRequest({ type: ACTION_MESSAGE_TYPE })).toBeNull();
    expect(
      parseActionRequest({ type: ACTION_MESSAGE_TYPE, frame: { ...ACTION_FRAME, id: "" } }),
    ).toBeNull();
    expect(
      parseActionRequest({ type: ACTION_MESSAGE_TYPE, frame: { ...ACTION_FRAME, action: "" } }),
    ).toBeNull();
    expect(
      parseActionRequest({ type: ACTION_MESSAGE_TYPE, frame: { ...ACTION_FRAME, target: 42 } }),
    ).toBeNull();
    expect(
      parseActionRequest({ type: ACTION_MESSAGE_TYPE, frame: { ...ACTION_FRAME, params: [] } }),
    ).toBeNull();
    expect(
      parseActionRequest({ type: ACTION_MESSAGE_TYPE, frame: { ...ACTION_FRAME, type: "nope" } }),
    ).toBeNull();
  });
});

describe("内容脚本的动作收信（entrypoints/content.ts 接的那一层）", () => {
  /** listener 是同步返回、sendResponse 异步被调：等一轮微任务再断言。 */
  async function respond(
    roster: Parameters<typeof actionListener>[0],
    message: unknown,
  ): Promise<ReturnType<typeof vi.fn>> {
    const sendResponse = vi.fn();
    const kept = actionListener(roster)(message, undefined, sendResponse);
    expect(kept).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    return sendResponse;
  }

  it("认得出的动作帧当场回一个 ActionOutcome（本轮名册空 → unknown-action）", async () => {
    const sendResponse = await respond({}, { type: ACTION_MESSAGE_TYPE, frame: ACTION_FRAME });

    expect(sendResponse).toHaveBeenCalledTimes(1);
    expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: "unknown-action" });
  });

  it("名册里有的动作走执行器，结果当 result 收下", async () => {
    const handler = vi.fn(() => ({ state: "idle" }));
    const sendResponse = await respond(
      { "page.state": handler },
      {
        type: ACTION_MESSAGE_TYPE,
        frame: ACTION_FRAME,
      },
    );

    expect(handler).toHaveBeenCalledTimes(1);
    expect(sendResponse).toHaveBeenCalledWith({ ok: true, result: { state: "idle" } });
  });

  it("认不出的消息不响应（不抢 ask 的消息、不回 undefined 当结果）", async () => {
    const sendResponse = vi.fn();
    expect(
      actionListener({})(askRequestMessage("ask-1", "问题"), undefined, sendResponse),
    ).toBeUndefined();
    expect(actionListener({})({ hello: "world" }, undefined, sendResponse)).toBeUndefined();
    expect(actionListener({})(undefined, undefined, sendResponse)).toBeUndefined();
    expect(
      actionListener({})(
        { type: ACTION_MESSAGE_TYPE, frame: { ...ACTION_FRAME, id: "" } },
        undefined,
        sendResponse,
      ),
    ).toBeUndefined();

    await Promise.resolve();
    expect(sendResponse).not.toHaveBeenCalled();
  });
});
