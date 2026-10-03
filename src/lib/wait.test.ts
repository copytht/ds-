import { describe, expect, it } from "vitest";

import { ACTION_ERROR_PAGE_CHANGED, ACTION_ERROR_TIMEOUT } from "./action";
import type { ActionFrame } from "./actionstream";
import { baselineKey, parseWaitSeconds, waitFence, waitReply, waitUntilNewMessage } from "./wait";
import type { ListViewport } from "./messages";

const FRAME: ActionFrame = {
  type: "action",
  id: "w-1",
  action: "wait.fence",
  params: {},
  target: "42",
};

function frameOf(action: string, params: Record<string, unknown> = {}): ActionFrame {
  return { ...FRAME, action, params };
}

/**
 * 造一条消息行：助手行认 `.ds-assistant-message-main-content`，
 * 用户行认 `.ds-message` + `.ds-collapsible-text`（结构照抄真机）。
 */
function rowHtml(key: string, text: string, assistant = true): string {
  const body = assistant
    ? `<div class="ds-markdown ds-assistant-message-main-content"><p>${text}</p></div>`
    : `<div class="ds-message"><div class="ds-collapsible-text"><div><span>${text}</span></div></div></div>`;
  return `<div data-virtual-list-item-key="${key}">${body}</div>`;
}

function listHtml(rows: string): string {
  return `<div class="ds-virtual-list"><div class="ds-virtual-list-items"><div class="ds-virtual-list-visible-items">${rows}</div></div></div>`;
}

/** 页面里的消息列表层；jsdom 不做布局，`scrollTop` 赋值是空操作，无碍。 */
function viewOf(): ListViewport {
  const view = document.querySelector(".ds-virtual-list");
  if (view === null) throw new Error("没有造出消息列表");
  return view;
}

/** 立刻 settle：基线跳底那一下不等真挂载（替身列表不会换行）。 */
const instant = (): Promise<void> => Promise.resolve();

/** 短的到期点：`waitUntilNewMessage` 的轮询不用等满真实预算。 */
function soon(ms = 20): number {
  return Date.now() + ms;
}

describe("等待预算", () => {
  it("没配与非法值按默认 25s", () => {
    expect(parseWaitSeconds(frameOf("wait.fence"))).toBe(25);
    expect(parseWaitSeconds(frameOf("wait.fence", { timeout: "10" }))).toBe(25);
    expect(parseWaitSeconds(frameOf("wait.fence", { timeout: Number.NaN }))).toBe(25);
  });

  it("配了取配值，钳在 [1, 25]", () => {
    expect(parseWaitSeconds(frameOf("wait.fence", { timeout: 3 }))).toBe(3);
    expect(parseWaitSeconds(frameOf("wait.fence", { timeout: 0.5 }))).toBe(1);
    expect(parseWaitSeconds(frameOf("wait.fence", { timeout: 999 }))).toBe(25);
    expect(parseWaitSeconds(frameOf("wait.fence", { timeout: -5 }))).toBe(1);
  });
});

describe("基线", () => {
  it("记下挂载行的最大行 key", async () => {
    document.body.innerHTML = listHtml(
      rowHtml("1", "旧问题", false) + rowHtml("2", "旧回答") + rowHtml("3", "更新的回答"),
    );
    expect(await baselineKey(viewOf(), instant)).toBe(3);
  });

  it("非数字 key 一律不认，基线落回 -1", async () => {
    document.body.innerHTML = listHtml(rowHtml("abc", "站点改了 key 格式"));
    expect(await baselineKey(viewOf(), instant)).toBe(-1);
  });
});

describe("轮询", () => {
  it("只认 key 大于基线的新消息", async () => {
    document.body.innerHTML = listHtml(
      rowHtml("1", "旧问题", false) +
        rowHtml("2", "旧回答") +
        rowHtml("3", "agent:\nstatus: ok\n新回灌"),
    );
    const found = await waitUntilNewMessage(
      viewOf(),
      2,
      soon(),
      (message) => message.text.startsWith("agent:"),
      1,
    );
    expect(found?.text).toContain("新回灌");
  });

  it("基线本身与更旧的行不算新消息", async () => {
    document.body.innerHTML = listHtml(
      rowHtml("1", "旧问题", false) + rowHtml("2", "agent:\n旧回灌"),
    );
    const found = await waitUntilNewMessage(
      viewOf(),
      2,
      soon(),
      (message) => message.text.startsWith("agent:"),
      1,
    );
    expect(found).toBeNull();
  });

  it("matches 不认的跳过，继续往下认", async () => {
    document.body.innerHTML = listHtml(rowHtml("3", "普通新回答") + rowHtml("4", "agent:\n新回灌"));
    const found = await waitUntilNewMessage(
      viewOf(),
      2,
      soon(),
      (message) => message.text.startsWith("agent:"),
      1,
    );
    expect(found?.text).toContain("新回灌");
  });

  it("到点没等到回 null", async () => {
    document.body.innerHTML = listHtml(rowHtml("1", "旧回答"));
    const found = await waitUntilNewMessage(viewOf(), 1, soon(), () => true, 1);
    expect(found).toBeNull();
  });
});

describe("wait.fence / wait.reply", () => {
  it("没有消息列表（新对话）当场报 page-changed", async () => {
    document.body.innerHTML = "";
    await expect(waitFence(frameOf("wait.fence"))).rejects.toMatchObject({
      code: ACTION_ERROR_PAGE_CHANGED,
    });
    await expect(waitReply(frameOf("wait.reply"))).rejects.toMatchObject({
      code: ACTION_ERROR_PAGE_CHANGED,
    });
  });

  it("基线里的旧围栏不误认：等不到新围栏回 timeout", async () => {
    document.body.innerHTML = listHtml(
      rowHtml("1", "旧问题", false) + rowHtml("2", "结论先放这：\n```send\n查一下旧天气\n```"),
    );
    await expect(waitFence(frameOf("wait.fence", { timeout: 1 }))).rejects.toMatchObject({
      code: ACTION_ERROR_TIMEOUT,
    });
  });

  it("基线里的旧回灌不误认：等不到新回灌回 timeout", async () => {
    document.body.innerHTML = listHtml(
      rowHtml("1", "旧问题", false) + rowHtml("2", "agent:\n旧回灌"),
    );
    await expect(waitReply(frameOf("wait.reply", { timeout: 1 }))).rejects.toMatchObject({
      code: ACTION_ERROR_TIMEOUT,
    });
  });
});
