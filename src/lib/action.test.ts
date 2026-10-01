import { describe, expect, it } from "vitest";

import {
  ACTION_ERROR_DISABLED,
  ACTION_ERROR_UNKNOWN,
  ACTION_RESULT_URL,
  listSessionTabs,
  postActionResult,
  runAction,
  sendMessageSendToTab,
  isActionOutcome,
  type ActionContext,
  type SessionTab,
  type TabCandidate,
  type TabsApi,
  type ToggleApi,
} from "./action";
import type { ActionFrame } from "./actionstream";
import { fixtureCases, fixtureFile, type ActionCase, type ActionFixtureFile } from "./fixtures";

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
  return { enabled: true, speak: true, tabs: tabsApi([]), ...overrides };
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
    if (!outcome.ok) throw new Error("tabs.list 没回结果");
    const result = outcome.result as { tabs: SessionTab[] };
    expect(Object.keys(result)).toEqual(Object.keys(fixture.response.result as object));
    expect(Object.keys(result.tabs[0] ?? {})).toEqual(
      Object.keys((fixture.response.result as { tabs: SessionTab[] }).tabs[0] ?? {}),
    );
  });
});

describe("总开关闸（关着不执行，回 disabled 让中继别等满超时）", () => {
  it("关着时连 tabs.query 都不问，但回一个册子里的 disabled", async () => {
    const tabs = tabsApi([DEEPSEEK_TAB]);
    const outcome = await runAction(frame(), context({ enabled: false, tabs }));

    expect(outcome).toEqual({ ok: false, error: "disabled" });
    expect(tabs.calls).toBe(0);
  });

  it("disabled 与共享 fixture 的样例同一份（TS 与 Python 共读）", () => {
    const book = (fixtureFile("action.json") as ActionFixtureFile).errorCodes.map(
      ({ code }) => code,
    );
    expect(book).toContain(ACTION_ERROR_DISABLED);
    const sample = fixtureCases<ActionCase>("action.json").find(
      ({ name }) => name === "总开关关闭失败",
    )?.response;
    if (!sample || sample.ok) throw new Error("fixture 里没有关开关的失败样例");
    expect(sample.error).toBe(ACTION_ERROR_DISABLED);
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

  it("target 不是纯数字串 → tab-gone（认不出的地址等于标签页不在）", async () => {
    for (const bad of ["不是数字", "42.5", "", " ", "1e3", "0x10", "-1", "+1", "9".repeat(30)]) {
      expect(await runAction(frame({ target: bad }), context())).toEqual({
        ok: false,
        error: "tab-gone",
      });
    }
  });

  it("没接执行口 → tab-gone（background 接上后不该出现，留作类型兜底）", async () => {
    expect(await runAction(frame({ target: "42" }), context())).toEqual({
      ok: false,
      error: "tab-gone",
    });
  });
});

describe("sendToTab 接线（background 侧的 browser.tabs.sendMessage）", () => {
  it("对端答的是同构载荷就原样透传", async () => {
    const seen: Array<{ tabId: number; frame: ActionFrame }> = [];
    const sendToTab = sendMessageSendToTab(async (tabId, frame) => {
      seen.push({ tabId, frame });
      return { ok: true, result: { text: "页面上的字" } };
    });

    const outcome = await sendToTab(42, frame({ target: "42" }));

    expect(seen).toEqual([{ tabId: 42, frame: frame({ target: "42" }) }]);
    expect(outcome).toEqual({ ok: true, result: { text: "页面上的字" } });
  });

  it("sendMessage 抛错（标签页没了 / 内容脚本没注入）→ tab-gone，不冒泡", async () => {
    const sendToTab = sendMessageSendToTab(async () => {
      throw new Error("Could not establish connection");
    });

    expect(await sendToTab(42, frame({ target: "42" }))).toEqual({
      ok: false,
      error: "tab-gone",
    });
  });

  it("对端答的形状认不出 → tab-gone（不当成功收下）", async () => {
    const sendToTab = sendMessageSendToTab(async () => ({ ok: "yes" }));

    expect(await sendToTab(42, frame({ target: "42" }))).toEqual({
      ok: false,
      error: "tab-gone",
    });
  });
});

function toggleApi(initial = false): ToggleApi & { value: boolean; sets: number } {
  const api = {
    value: initial,
    sets: 0,
    async get(): Promise<boolean> {
      return api.value;
    },
    async set(value: boolean): Promise<boolean> {
      api.value = value;
      api.sets += 1;
      return api.value;
    },
  };
  return api;
}

describe("toggle.get / toggle.set", () => {
  it("toggle.get 回总开关当前状态", async () => {
    const toggle = toggleApi(true);
    expect(await runAction(frame({ action: "toggle.get" }), context({ toggle }))).toEqual({
      ok: true,
      result: { enabled: true },
    });
  });

  it("toggle.set 写入并回新状态", async () => {
    const toggle = toggleApi(false);
    const outcome = await runAction(
      frame({ action: "toggle.set", params: { enabled: true } }),
      context({ toggle }),
    );
    expect(outcome).toEqual({ ok: true, result: { enabled: true } });
    expect(toggle.value).toBe(true);
    expect(toggle.sets).toBe(1);
  });

  it("toggle.set 参数不是布尔 → unknown-action，别假装写过了", async () => {
    const toggle = toggleApi(false);
    for (const bad of [undefined, null, "true", 1, {}, []]) {
      expect(
        await runAction(
          frame({ action: "toggle.set", params: { enabled: bad } }),
          context({ toggle }),
        ),
      ).toEqual({ ok: false, error: "unknown-action" });
    }
    expect(toggle.sets).toBe(0);
  });

  it("context 没接 toggle → toggle.get/set 都回 unknown-action", async () => {
    expect(await runAction(frame({ action: "toggle.get" }), context())).toEqual({
      ok: false,
      error: "unknown-action",
    });
    expect(
      await runAction(frame({ action: "toggle.set", params: { enabled: true } }), context()),
    ).toEqual({ ok: false, error: "unknown-action" });
  });
});

describe("总开关关着时的豁免（toggle.*）", () => {
  it("enabled=false 时 toggle.get / toggle.set 照常执行", async () => {
    const toggle = toggleApi(false);
    const ctx = context({ enabled: false, toggle });
    expect(await runAction(frame({ action: "toggle.get" }), ctx)).toEqual({
      ok: true,
      result: { enabled: false },
    });
    expect(
      await runAction(frame({ action: "toggle.set", params: { enabled: true } }), ctx),
    ).toEqual({ ok: true, result: { enabled: true } });
    expect(toggle.value).toBe(true);
  });

  it("enabled=false 时其余动作一律 disabled（含 tabs.list / 带 target 的）", async () => {
    const ctx = context({ enabled: false, toggle: toggleApi(false) });
    expect(await runAction(frame({ action: "tabs.list" }), ctx)).toEqual({
      ok: false,
      error: "disabled",
    });
    expect(await runAction(frame({ action: "composer.read", target: "42" }), ctx)).toEqual({
      ok: false,
      error: "disabled",
    });
  });
});

describe("名册有、扩展还没实现的动作", () => {
  it("还没实现的动作当场回 unknown-action，别让中继等满 30s", async () => {
    const outcome = await runAction(frame({ action: "page.state" }), context());

    expect(outcome).toEqual({ ok: false, error: "unknown-action" });
  });

  it("unknown-action 与共享 fixture 的样例同一份（TS 与 Python 共读）", () => {
    const book = (fixtureFile("action.json") as ActionFixtureFile).errorCodes.map(
      ({ code }) => code,
    );
    expect(book).toContain(ACTION_ERROR_UNKNOWN);
    const sample = fixtureCases<ActionCase>("action.json").find(
      ({ name }) => name === "未知动作失败",
    )?.response;
    if (!sample || sample.ok) throw new Error("fixture 里没有未知动作的失败样例");
    expect(sample.error).toBe(ACTION_ERROR_UNKNOWN);
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

describe("isActionOutcome 形状", () => {
  it("ok:true 必须有非 undefined 的 result", () => {
    expect(isActionOutcome({ ok: true, result: null })).toBe(true);
    expect(isActionOutcome({ ok: true, result: 0 })).toBe(true);
    expect(isActionOutcome({ ok: true, result: undefined })).toBe(false);
    expect(isActionOutcome({ ok: true })).toBe(false);
  });

  it("ok:false 必须有非空 error 字符串", () => {
    expect(isActionOutcome({ ok: false, error: "x" })).toBe(true);
    expect(isActionOutcome({ ok: false, error: "" })).toBe(false);
    expect(isActionOutcome({ ok: false })).toBe(false);
    expect(isActionOutcome({ ok: false, error: 42 })).toBe(false);
  });

  it("不是对象 / ok 非布尔一律不认", () => {
    expect(isActionOutcome(null)).toBe(false);
    expect(isActionOutcome(undefined)).toBe(false);
    expect(isActionOutcome("yes")).toBe(false);
    expect(isActionOutcome({ ok: "yes" })).toBe(false);
  });
});

describe("「代你发言」闸", () => {
  const ok = async () => ({ ok: true, result: {} }) as const;

  it("闸关着时动写作框的动作回 disabled，读不受管", async () => {
    const ctx = context({ speak: false, sendToTab: ok });
    expect(await runAction(frame({ action: "composer.type", target: "42" }), ctx)).toEqual({
      ok: false,
      error: "disabled",
    });
    expect(await runAction(frame({ action: "composer.clear", target: "42" }), ctx)).toEqual({
      ok: false,
      error: "disabled",
    });
    // 读不受这个闸管：看一眼你写了什么不算替你开口。
    expect(await runAction(frame({ action: "composer.read", target: "42" }), ctx)).toEqual({
      ok: true,
      result: {},
    });
  });

  it("闸开着时照常走", async () => {
    const ctx = context({ speak: true, sendToTab: ok });
    expect(await runAction(frame({ action: "composer.type", target: "42" }), ctx)).toEqual({
      ok: true,
      result: {},
    });
  });
});
