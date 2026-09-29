import { describe, expect, it } from "vitest";

import {
  askRequestMessage,
  askResponseMessage,
  CHAIN_MESSAGE_SOURCE,
  isReplyPayload,
  parseAskRequest,
  parseAskResponse,
  parseChainMessage,
  questionMessage,
  resultMessage,
  unreachableResult,
} from "./channel";

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
