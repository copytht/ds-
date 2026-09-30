import { describe, expect, it } from "vitest";

import {
  ACTION_RESULT_URL,
  listSessionTabs,
  postActionResult,
  runAction,
  type ActionContext,
  type SessionTab,
  type TabCandidate,
  type TabsApi,
} from "./action";
import type { ActionFrame } from "./actionstream";
import { fixtureCases, type ActionCase } from "./fixtures";

function tabsApi(tabs: readonly TabCandidate[]): TabsApi & { calls: number } {
  const api = {
    calls: 0,
    async query(): Promise<readonly TabCandidate[]> {
      api.calls += 1;
      return tabs;
    },
  };
  return api;
}

function context(overrides: Partial<ActionContext> = {}): ActionContext {
  return { enabled: true, tabs: tabsApi([]), ...overrides };
}

function frame(overrides: Partial<ActionFrame> = {}): ActionFrame {
  return { type: "action", id: "1-a", action: "tabs.list", params: {}, target: null, ...overrides };
}

const DEEPSEEK_TAB: TabCandidate = {
  id: 42,
  title: "DeepSeek - 深度求索",
  url: "https://chat.deepseek.com/a/chat/s/abc123",
};

describe("tabs.list 执行器", () => {
  it("只留 chat.deepseek.com，每项 { id, title, url }", async () => {
    const tabs = tabsApi([
      DEEPSEEK_TAB,
      { id: 7, title: "别的站", url: "https://example.com/a/chat/s/nope" },
      { id: 8, title: "没有 url 的 deepseek 标签页" },
      { id: undefined, title: "没有 id", url: "https://chat.deepseek.com/a/chat/s/x" },
      { id: 9, title: undefined, url: "这一行不是 url" },
      { id: 10, title: "deepseek 首页", url: "https://chat.deepseek.com/" },
    ]);

    expect(await listSessionTabs(tabs)).toEqual([
      { id: 42, title: "DeepSeek - 深度求索", url: "https://chat.deepseek.com/a/chat/s/abc123" },
      { id: 10, title: "deepseek 首页", url: "https://chat.deepseek.com/" },
    ]);
    expect(tabs.calls).toBe(1);
  });

  it("结果形状与 protocol/fixtures/action.json 的成功样例同形", async () => {
    const fixture = fixtureCases<ActionCase>("action.json").find(
      ({ name }) => name === "tabs.list 成功",
    );
    expect(fixture).toBeDefined();
    if (!fixture || fixture.response.ok === false) throw new Error("fixture 缺成功样例");

    const outcome = await runAction(frame(), context({ tabs: tabsApi([DEEPSEEK_TAB]) }));

    expect(outcome).toEqual({ ok: true, result: { tabs: [DEEPSEEK_TAB] } });
    if (outcome === null || !outcome.ok) throw new Error("tabs.list 没回结果");
    const result = outcome.result as { tabs: SessionTab[] };
    expect(Object.keys(result)).toEqual(Object.keys(fixture.response.result as object));
    expect(Object.keys(result.tabs[0] ?? {})).toEqual(
      Object.keys((fixture.response.result as { tabs: SessionTab[] }).tabs[0] ?? {}),
    );
  });
});

describe("总开关闸（关着不执行，与中继 disabled 同义）", () => {
  it("关着时连 tabs.query 都不问，也不回传", async () => {
    const tabs = tabsApi([DEEPSEEK_TAB]);
    const outcome = await runAction(frame(), context({ enabled: false, tabs }));

    expect(outcome).toBeNull();
    expect(tabs.calls).toBe(0);
  });
});

describe("按 target 路由", () => {
  it("target 指名的标签页交给 sendToTab，结果原样回传", async () => {
    const seen: Array<{ tabId: number; frame: ActionFrame }> = [];
    const target = frame({ action: "composer.read", target: "42" });
    const outcome = await runAction(
      target,
      context({
        sendToTab: async (tabId, received) => {
          seen.push({ tabId, frame: received });
          return { ok: true, result: { text: "页面上的字" } };
        },
      }),
    );

    expect(seen).toEqual([{ tabId: 42, frame: target }]);
    expect(outcome).toEqual({ ok: true, result: { text: "页面上的字" } });
  });

  it("target 认不出或没有执行口 → 不回传", async () => {
    expect(await runAction(frame({ target: "不是数字" }), context())).toBeNull();
    expect(await runAction(frame({ target: "42" }), context())).toBeNull();
  });

  it("还没实现的动作不回传，让中继按 timeout 收场", async () => {
    expect(await runAction(frame({ action: "page.state" }), context())).toBeNull();
  });
});

describe("结果回传", () => {
  it("成功带 result、失败带 error，id 原样还回去", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const post = async (url: string, init: { body: string }) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return {};
    };

    await postActionResult(post, "7-x", { ok: true, result: { tabs: [] } });
    await postActionResult(post, "7-x", { ok: false, error: "tab-gone" });

    expect(calls[0]).toEqual({
      url: ACTION_RESULT_URL,
      body: { id: "7-x", ok: true, result: { tabs: [] } },
    });
    expect(calls[1]).toEqual({
      url: ACTION_RESULT_URL,
      body: { id: "7-x", ok: false, error: "tab-gone" },
    });
  });
});
