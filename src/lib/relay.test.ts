import { describe, expect, it } from "vitest";

import {
  FAILURE_RELAY_UNREACHABLE,
  FAILURE_UNEXPECTED_RESPONSE,
  parseRelayResponse,
  relayAskBody,
  relayAskUrl,
  relayHealthUrl,
} from "./relay";

describe("端点与请求体", () => {
  it("打的是本机中继的 /ask 与 /health", () => {
    expect(relayAskUrl()).toBe("http://127.0.0.1:8787/ask");
    expect(relayHealthUrl()).toBe("http://127.0.0.1:8787/health");
  });

  it("请求体只有 question 一条", () => {
    expect(relayAskBody("问题正文")).toBe('{"question":"问题正文"}');
    expect(JSON.parse(relayAskBody("问题正文"))).toEqual({ question: "问题正文" });
  });
});

describe("parseRelayResponse · 响应 → 载荷", () => {
  it("200 + status ok → ok 载荷，answer 原样", () => {
    const payload = parseRelayResponse(200, JSON.stringify({ status: "ok", answer: "答复" }));
    expect(payload).toEqual({ status: "ok", answer: "答复" });
  });

  it("200 + status error → 同构的 error 载荷，错误码原样带出", () => {
    for (const error of [
      "opencode-not-running",
      "opencode-timeout",
      "unexpected-response",
      "某个还没在册的新错误码",
    ]) {
      expect(parseRelayResponse(200, JSON.stringify({ status: "error", error }))).toEqual({
        status: "error",
        error,
      });
    }
  });

  it("非 2xx 一律按中继响应异常，不猜", () => {
    expect(parseRelayResponse(400, JSON.stringify({ status: "ok", answer: "x" }))).toEqual({
      status: "error",
      error: FAILURE_UNEXPECTED_RESPONSE,
    });
    expect(parseRelayResponse(500, "").status).toBe("error");
    expect(parseRelayResponse(404, JSON.stringify({ status: "error", error: "x" }))).toEqual({
      status: "error",
      error: FAILURE_UNEXPECTED_RESPONSE,
    });
  });

  it("响应体不是 JSON、不是对象、字段缺着，都落中继响应异常", () => {
    const unexpected = { status: "error", error: FAILURE_UNEXPECTED_RESPONSE };
    expect(parseRelayResponse(200, "不是 JSON")).toEqual(unexpected);
    expect(parseRelayResponse(200, '"ok"')).toEqual(unexpected);
    expect(parseRelayResponse(200, "[]")).toEqual(unexpected);
    expect(parseRelayResponse(200, JSON.stringify({ answer: "只有 answer" }))).toEqual(unexpected);
    expect(parseRelayResponse(200, JSON.stringify({ status: "ok" }))).toEqual(unexpected);
    expect(parseRelayResponse(200, JSON.stringify({ status: "ok", answer: "   " }))).toEqual(
      unexpected,
    );
    expect(parseRelayResponse(200, JSON.stringify({ status: "error" }))).toEqual(unexpected);
    expect(parseRelayResponse(200, JSON.stringify({ status: "wat", error: "x" }))).toEqual(
      unexpected,
    );
  });

  it("网络层失败（没起 / 超时 / 被拦）也有一个在册的载荷可用", () => {
    expect(FAILURE_RELAY_UNREACHABLE).toBe("relay-unreachable");
  });
});
