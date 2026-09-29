import { describe, expect, it } from "vitest";

import { fixtureCases, type OpencodeCase, type ReplyCase } from "./fixtures";
import {
  buildReply,
  errorPayload,
  failureNotice,
  isInjectableReply,
  isKnownFailureKind,
  okPayload,
  REPLY_ANCHOR,
  RELAY_START_COMMAND,
} from "./reply";

describe("buildReply · 共享 fixture", () => {
  for (const { name, payload, expectedMessage } of fixtureCases<ReplyCase>("reply.json")) {
    it(name, () => {
      expect(buildReply(payload)).toBe(expectedMessage);
      expect(expectedMessage.split("\n")[0]).toBe(REPLY_ANCHOR);
    });
  }
});

describe("buildReply", () => {
  it("首行是固定的 agent: 字面量", () => {
    expect(buildReply(okPayload("答案")).split("\n")[0]).toBe(REPLY_ANCHOR);
    expect(buildReply(errorPayload("opencode-timeout")).split("\n")[0]).toBe(REPLY_ANCHOR);
    expect(buildReply(okPayload("答案")).startsWith(`agent:\n`)).toBe(true);
  });

  it("载荷是 TOON，status 在第一行", () => {
    expect(buildReply(okPayload("答案")).split("\n")[1]).toBe("status: ok");
    expect(buildReply(errorPayload("opencode-timeout")).split("\n")[1]).toBe("status: error");
  });
});

describe("载荷同构", () => {
  it("ok 载荷带 answer", () => {
    expect(okPayload("答案")).toEqual({ status: "ok", answer: "答案" });
  });

  it("error 载荷带 error", () => {
    expect(errorPayload("opencode-timeout")).toEqual({
      status: "error",
      error: "opencode-timeout",
    });
  });
});

describe("isInjectableReply · 失败不进对话流", () => {
  it("status: ok 才回灌进页面", () => {
    expect(isInjectableReply(okPayload("答案"))).toBe(true);
  });

  it("status: error 不进对话流", () => {
    expect(isInjectableReply(errorPayload("opencode-not-running"))).toBe(false);
    expect(isInjectableReply(errorPayload("relay-unreachable"))).toBe(false);
  });
});

describe("failureNotice · 扩展侧失败提示", () => {
  it("dsb 吐出的每个错误码都有在册的失败提示", () => {
    const codes = fixtureCases<OpencodeCase>("opencode.json").map(
      ({ expectedPayload }) => expectedPayload.status === "error" && expectedPayload.error,
    );
    const errorCodes = codes.filter((code): code is string => typeof code === "string");
    expect(errorCodes.length).toBeGreaterThan(0);
    for (const code of errorCodes) {
      expect(isKnownFailureKind(code)).toBe(true);
    }
  });

  it("dsb 没起时给「中继不可达」并带上启动命令", () => {
    const notice = failureNotice("opencode-not-running");
    expect(notice.title).toBe("中继不可达");
    expect(notice.reason).toContain("opencode");
    expect(notice.command).toBe(RELAY_START_COMMAND);
  });

  it("中继本身没响应时也给「中继不可达」", () => {
    expect(failureNotice("relay-unreachable").title).toBe("中继不可达");
    expect(failureNotice("relay-unreachable").command).toBe("uv run ds-mcp");
  });

  it("没问成的原因都带启动命令", () => {
    for (const kind of [
      "relay-unreachable",
      "opencode-not-running",
      "opencode-timeout",
      "unexpected-response",
    ]) {
      expect(failureNotice(kind).command).toBe(RELAY_START_COMMAND);
    }
  });

  it("认不出的原因降级成一条兜底提示", () => {
    const notice = failureNotice("something-new");
    expect(isKnownFailureKind("something-new")).toBe(false);
    expect(notice.title).toBe("中继不可达");
    expect(notice.reason).toContain("something-new");
  });
});
