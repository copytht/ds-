import { describe, expect, it } from "vitest";

import {
  ASK_PHASES,
  FAILURE_RELAY_UNREACHABLE,
  FAILURE_UNEXPECTED_RESPONSE,
  describeFetchFailure,
  describeStatusFailure,
  parseRelayResponse,
  parseStatusResponse,
  relayAskBody,
  relayAskUrl,
  relayHealthUrl,
  relayStatusUrl,
} from "./relay";

describe("端点与请求体", () => {
  it("打的是本机中继的 /ask、/health 与 /status", () => {
    expect(relayAskUrl()).toBe("http://127.0.0.1:8787/ask");
    expect(relayHealthUrl()).toBe("http://127.0.0.1:8787/health");
    expect(relayStatusUrl()).toBe("http://127.0.0.1:8787/status");
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

describe("parseStatusResponse · 等待期的现场快照", () => {
  function snapshot(body: unknown, status = 200) {
    return parseStatusResponse(status, JSON.stringify(body));
  }

  it("中继答得体面但没有问句在途 → 可信、现场为空", () => {
    expect(snapshot({ status: "ok", ask: null })).toEqual({ reachable: true, ask: null });
  });

  it("有问句在途 → 阶段、字数、剩余预算原样带出", () => {
    expect(
      snapshot({ status: "ok", ask: { phase: "writing", written: 128, remaining: 107.5 } }),
    ).toEqual({ reachable: true, ask: { phase: "writing", written: 128, remaining: 107.5 } });
  });

  it("remaining 为 null 合法（还没定下用哪一段），缺着就同罪", () => {
    expect(
      snapshot({ status: "ok", ask: { phase: "queued", written: 0, remaining: null } }),
    ).toEqual({
      reachable: true,
      ask: { phase: "queued", written: 0, remaining: null },
    });
    expect(snapshot({ status: "ok", ask: { phase: "running", written: 0 } })).toEqual({
      reachable: false,
      ask: null,
    });
  });

  it("四个阶段都认", () => {
    for (const phase of ASK_PHASES) {
      expect(snapshot({ status: "ok", ask: { phase, written: 0, remaining: 1 } }).ask?.phase).toBe(
        phase,
      );
    }
  });

  it("认不得的一律当「这条不可信」——快照是拿去上屏的，不猜", () => {
    const offline = { reachable: false, ask: null };
    expect(parseStatusResponse(500, JSON.stringify({ status: "ok", ask: null }))).toEqual(offline);
    expect(parseStatusResponse(200, "不是 JSON")).toEqual(offline);
    expect(parseStatusResponse(200, "[]")).toEqual(offline);
    expect(parseStatusResponse(200, JSON.stringify({ status: "wat", ask: null }))).toEqual(offline);
    expect(snapshot({ status: "ok" })).toEqual(offline); // 字段缺着跟字段坏了同罪
    for (const ask of [
      "不是对象",
      { phase: "跑步", written: 0, remaining: 1 }, // 没在册的阶段
      { phase: "queued", written: -1, remaining: 1 },
      { phase: "queued", written: "128", remaining: 1 },
      { phase: "queued", written: 0, remaining: "快好了" },
      { phase: "queued" }, // 缺 written
      true,
    ]) {
      expect(snapshot({ status: "ok", ask })).toEqual(offline);
    }
    // 唯独 ask: null 不在此列——那是「中继在、只是没问句在途」。
    expect(snapshot({ status: "ok", ask: null })).toEqual({ reachable: true, ask: null });
  });
});

describe("失败原因的折算 · 翻红之后总得说得出为什么", () => {
  it("自己掐表超时和连都没连上，是两件排查方向相反的事", () => {
    expect(
      describeFetchFailure(new DOMException("The operation was aborted.", "AbortError"), 5000),
    ).toBe("超时（5000ms 没回）");
    expect(describeFetchFailure(new TypeError("Failed to fetch"), 5000)).toBe("连接失败");
    expect(describeFetchFailure("没头没尾的", 5000)).toBe("连接失败");
  });

  it("响应到了但读不出现场：报状态码，2xx 就报正文规模——不报正文本身", () => {
    expect(describeStatusFailure(500, "Internal Server Error")).toBe("HTTP 500");
    expect(describeStatusFailure(200, "不是 JSON")).toBe("响应读不出来（7 字）");
    expect(describeStatusFailure(200, "")).toBe("响应读不出来（0 字）");
  });
});
