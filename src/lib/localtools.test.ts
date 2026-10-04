import { describe, expect, it } from "vitest";

import type { ActionOutcome } from "./action";
import { LOCAL_TOOLS, findLocalTool, normalizeSeconds } from "./localtools";
import { buildReply, okPayload } from "./reply";

const SEND_PAGE = findLocalTool("send.page");
if (SEND_PAGE === null) throw new Error("名册里应有 send.page");

type Call = { readonly action: string; readonly params: Record<string, unknown> };

/**
 * 记录调用的假 `run`：默认每步成功、`wait.reply` 回一条正常回灌；
 * `overrides` 按动作名替换某一步的结果（模拟闸挡 / 超时）。
 */
function recorder(overrides: Record<string, ActionOutcome> = {}) {
  const calls: Call[] = [];
  const run = async (action: string, params: Record<string, unknown>): Promise<ActionOutcome> => {
    calls.push({ action, params });
    const hit = overrides[action];
    if (hit !== undefined) return hit;
    if (action === "wait.fence") return { ok: true, result: { question: '{"tool":"x"}' } };
    if (action === "wait.reply") {
      return { ok: true, result: { text: buildReply(okPayload("答复正文")) } };
    }
    return { ok: true, result: {} };
  };
  return { calls, run };
}

describe("findLocalTool · 名册", () => {
  it("按名字找得到 send.page", () => {
    expect(findLocalTool("send.page")).toBe(SEND_PAGE);
  });

  it("不是本地的（网关工具）一律 null", () => {
    expect(findLocalTool("fs_read_file")).toBeNull();
    expect(findLocalTool("")).toBeNull();
  });

  it("名册 v1 只有 send.page", () => {
    expect(LOCAL_TOOLS.map((tool) => tool.name)).toEqual(["send.page"]);
  });
});

describe("normalizeSeconds · 等待预算口径（与 wait.ts 一致）", () => {
  it("非法 / 缺省按默认 25", () => {
    expect(normalizeSeconds(undefined)).toBe(25);
    expect(normalizeSeconds("10")).toBe(25);
    expect(normalizeSeconds(Number.NaN)).toBe(25);
  });

  it("越界钳在 [1, 25]", () => {
    expect(normalizeSeconds(0)).toBe(1);
    expect(normalizeSeconds(-3)).toBe(1);
    expect(normalizeSeconds(99)).toBe(25);
    expect(normalizeSeconds(7)).toBe(7);
  });
});

describe("send.page · 组合四步", () => {
  it("依次 composer.type → send.enter → wait.fence → wait.reply，回答复正文", async () => {
    const { calls, run } = recorder();

    const payload = await SEND_PAGE.run({ question: "帮我看看" }, { tabId: 42, run });

    expect(payload).toEqual(okPayload("答复正文"));
    expect(calls.map((call) => call.action)).toEqual([
      "composer.type",
      "send.enter",
      "wait.fence",
      "wait.reply",
    ]);
    expect(calls[0]?.params).toEqual({ text: "帮我看看" });
    expect(calls[1]?.params).toEqual({});
    expect(calls[2]?.params).toEqual({ timeout: 25 });
    expect(calls[3]?.params).toEqual({ timeout: 25 });
  });

  it("seconds 归一到等待入参（越界钳、缺省）", async () => {
    const { calls, run } = recorder();
    await SEND_PAGE.run({ question: "q", seconds: 99 }, { tabId: 1, run });
    expect(calls[2]?.params).toEqual({ timeout: 25 });
    expect(calls[3]?.params).toEqual({ timeout: 25 });
  });

  it("多行答复原样保真（buildReply↔parseReplyPayload 往返）", async () => {
    const { run } = recorder({
      "wait.reply": { ok: true, result: { text: buildReply(okPayload("第一行\n第二行")) } },
    });

    expect(await SEND_PAGE.run({ question: "q" }, { tabId: 1, run })).toEqual(
      okPayload("第一行\n第二行"),
    );
  });

  it("没有 tab（消息不带 target）→ tab-gone，一步都不跑", async () => {
    const { calls, run } = recorder();
    expect(await SEND_PAGE.run({ question: "q" }, { tabId: undefined, run })).toEqual({
      status: "error",
      error: "tab-gone",
    });
    expect(calls).toEqual([]);
  });

  it("question 非法（缺 / 空 / 非串）→ unknown-action，不发送", async () => {
    const { calls, run } = recorder();
    for (const args of [{}, { question: "" }, { question: "   " }, { question: 42 }]) {
      expect(await SEND_PAGE.run(args, { tabId: 1, run })).toEqual({
        status: "error",
        error: "unknown-action",
      });
    }
    expect(calls).toEqual([]);
  });
});

describe("send.page · 任一步没成就停、原码回", () => {
  it("第一步被闸挡（替人发言关）→ disabled，页面不发送", async () => {
    const { calls, run } = recorder({
      "composer.type": { ok: false, error: "disabled" },
    });

    expect(await SEND_PAGE.run({ question: "q" }, { tabId: 1, run })).toEqual({
      status: "error",
      error: "disabled",
    });
    expect(calls.map((call) => call.action)).toEqual(["composer.type"]);
  });

  it("发送步被挡 → 只跑到 send.enter 就停", async () => {
    const { calls, run } = recorder({ "send.enter": { ok: false, error: "backing-off" } });

    expect(await SEND_PAGE.run({ question: "q" }, { tabId: 1, run })).toEqual({
      status: "error",
      error: "backing-off",
    });
    expect(calls.map((call) => call.action)).toEqual(["composer.type", "send.enter"]);
  });

  it("等围栏超时 → timeout，不去等回灌", async () => {
    const { calls, run } = recorder({ "wait.fence": { ok: false, error: "timeout" } });

    expect(await SEND_PAGE.run({ question: "q" }, { tabId: 1, run })).toEqual({
      status: "error",
      error: "timeout",
    });
    expect(calls.map((call) => call.action)).toEqual(["composer.type", "send.enter", "wait.fence"]);
  });
});

describe("send.page · 回灌解不出就说页面变了", () => {
  it("回灌首行不是锚 → page-changed", async () => {
    const { run } = recorder({ "wait.reply": { ok: true, result: { text: "不是回灌" } } });
    expect(await SEND_PAGE.run({ question: "q" }, { tabId: 1, run })).toEqual({
      status: "error",
      error: "page-changed",
    });
  });

  it("wait.reply 结果里没有 text → page-changed", async () => {
    const { run } = recorder({ "wait.reply": { ok: true, result: {} } });
    expect(await SEND_PAGE.run({ question: "q" }, { tabId: 1, run })).toEqual({
      status: "error",
      error: "page-changed",
    });
  });
});
