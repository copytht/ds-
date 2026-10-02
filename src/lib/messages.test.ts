import { describe, expect, it } from "vitest";

import type { ActionFrame } from "./actionstream";
import {
  lastMessage,
  listMessages,
  readLast,
  readMessages,
  readRow,
  type ListViewport,
} from "./messages";

const FRAME: ActionFrame = {
  type: "action",
  id: "m-1",
  action: "messages.list",
  params: {},
  target: "42",
};

/**
 * 夹具照抄 2026-10-02 真机抓的结构（页面 commit-id 44809ea4），**文字全是编的**：
 * 行 key、`ds-*` 设计系统类、哈希 class 的位置都按真的来，这样站点一改版测试先红。
 */
function conversationHtml(): string {
  return `
    <div class="ds-virtual-list ds-scroll-area--enabled">
      <div class="ds-virtual-list-items">
        <div class="ds-virtual-list-visible-items">
          <div class="_9663006 _2c189bc" data-virtual-list-item-key="1">
            <div class="d29f3d7d ds-message _63c77b1">
              <div class="fbb737a4">
                <div class="ds-collapsible-text"><div><span>帮我看一眼这段代码</span></div></div>
              </div>
              <div class="_11d6b3a">
                <div role="button" class="ds-button ds-button--icon"><div class="ds-icon"></div></div>
              </div>
            </div>
          </div>
          <div class="_4f9bf79 _43c05b5" data-virtual-list-item-key="2">
            <div class="ds-message _63c77b1">
              <div class="_74c0879">
                <div class="e1675d8b ds-think-content">
                  <div class="ds-markdown"><p>先想想：这里有个坑</p></div>
                </div>
                <div class="e1675d8b ds-think-content">
                  <div class="ds-markdown"><p>想完了，就它吧</p></div>
                </div>
              </div>
              <div class="ds-markdown ds-assistant-message-main-content">
                <p>答案是 <strong>4271</strong>。</p>
                <h3>说明</h3>
                <ul><li><p>第一点</p></li><li><p>第二点</p></li></ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>`;
}

function frameOf(action: string): ActionFrame {
  return { ...FRAME, action };
}

/** 第 index 条挂载出来的行；没有就当场抛，别把「没这行」演成 `undefined` 混过去。 */
function rowAt(index: number): Element {
  const row = document.querySelectorAll("[data-virtual-list-item-key]")[index];
  if (row === undefined) throw new Error(`没有第 ${index} 行`);
  return row;
}

describe("一行 → 一条消息", () => {
  it("用户行认可折叠文本，助手行认设计系统那个正文类", () => {
    document.body.innerHTML = conversationHtml();
    expect(readRow(rowAt(0))).toEqual({ role: "user", text: "帮我看一眼这段代码" });
    expect(readRow(rowAt(1))).toEqual({
      role: "assistant",
      text: "答案是 4271。\n\n说明\n\n第一点\n\n第二点",
    });
  });

  it("思考块是正文的兄弟节点，取正文类天然排掉它", () => {
    document.body.innerHTML = conversationHtml();
    const assistant = rowAt(1);
    const text = readRow(assistant)?.text ?? "";

    expect(text).not.toContain("先想想");
    expect(text).not.toContain("想完了");
  });

  it("行容器的哈希 class 换掉、去掉都照样认得出（#15：不用会随部署变的 class）", () => {
    document.body.innerHTML = conversationHtml()
      .replace(/_\w{6,7}/g, "rotated-hash")
      .replace(/ d29f3d7d/g, "");
    expect(readRow(rowAt(0))?.role).toBe("user");
    expect(readRow(rowAt(1))?.role).toBe("assistant");
  });

  it("不是消息行的行跳过，认不出的 ds-message 行也跳过——不猜角色", () => {
    document.body.innerHTML = `
      <div class="ds-virtual-list">
        <div data-virtual-list-item-key="1"><span>日期分隔条</span></div>
        <div data-virtual-list-item-key="2"><div class="ds-message"><div>没有可折叠文本</div></div></div>
      </div>`;
    expect(readRow(rowAt(0))).toBeNull();
    expect(readRow(rowAt(1))).toBeNull();
  });

  it("块级元素分行，行内空格留着——不然段落会粘成一坨", () => {
    document.body.innerHTML = `
      <div class="ds-virtual-list">
        <div data-virtual-list-item-key="1">
          <div class="ds-message"><div class="ds-markdown ds-assistant-message-main-content">
            <p>第一段</p><p>第二段</p>
          </div></div>
        </div>
      </div>`;
    const row = document.querySelector("[data-virtual-list-item-key]") as Element;

    expect(readRow(row)?.text).toBe("第一段\n\n第二段");
  });
});

describe("messages.list / messages.last 执行器", () => {
  it("读出按序的全部消息", async () => {
    document.body.innerHTML = conversationHtml();

    expect(await listMessages(frameOf("messages.list"))).toEqual({
      messages: [
        { role: "user", text: "帮我看一眼这段代码" },
        { role: "assistant", text: "答案是 4271。\n\n说明\n\n第一点\n\n第二点" },
      ],
    });
  });

  it("只回最后一条，形状与 list 一致", async () => {
    document.body.innerHTML = conversationHtml();

    expect(await lastMessage(frameOf("messages.last"))).toEqual({
      messages: [{ role: "assistant", text: "答案是 4271。\n\n说明\n\n第一点\n\n第二点" }],
    });
  });

  it("新对话一行都没有：回空数组，不算错", async () => {
    document.body.innerHTML = "<div>空的</div>";

    expect(await listMessages(frameOf("messages.list"))).toEqual({ messages: [] });
    expect(await lastMessage(frameOf("messages.last"))).toEqual({ messages: [] });
  });

  it("挂着行却一条都认不出 = 结构变了，当场抛，别装作空对话", async () => {
    document.body.innerHTML = `
      <div class="ds-virtual-list">
        <div data-virtual-list-item-key="1"><div class="ds-message"><div>认不出</div></div></div>
      </div>`;

    await expect(listMessages(frameOf("messages.list"))).rejects.toThrow("认不出消息行");
    await expect(lastMessage(frameOf("messages.last"))).rejects.toThrow("认不出消息行");
  });
});

/**
 * 假虚拟列表：jsdom 不做布局（`clientHeight` 恒为 0），真元素滚不动。
 * 每屏是**一批不同**的行——照抄真虚拟列表的挂载/卸载行为。
 */
function virtualScreens(screens: string[][]): ListViewport {
  const HEIGHT = 100;
  const host = document.createElement("div");
  let index = 0;
  const paint = (): void => {
    host.innerHTML = screens[index]?.join("") ?? "";
  };
  paint();
  return {
    get scrollTop(): number {
      return index * HEIGHT;
    },
    set scrollTop(value: number) {
      index = Math.min(screens.length - 1, Math.max(0, Math.round(value / HEIGHT)));
      paint();
    },
    get clientHeight(): number {
      return HEIGHT;
    },
    get scrollHeight(): number {
      return screens.length * HEIGHT;
    },
    querySelectorAll: (selector: string) => host.querySelectorAll(selector),
  };
}

function keyRow(key: number, role: "user" | "assistant"): string {
  const body =
    role === "user"
      ? `<div class="ds-collapsible-text"><span>第 ${key} 问</span></div>`
      : `<div class="ds-markdown ds-assistant-message-main-content"><p>第 ${key} 答</p></div>`;
  return `<div data-virtual-list-item-key="${key}"><div class="ds-message">${body}</div></div>`;
}

const settleNow = async (): Promise<void> => {};

describe("虚拟列表：只有视口里的行在 DOM", () => {
  it("一屏一屏滚下去，超出首屏的也收得回来，且顺序是对话顺序", async () => {
    const view = virtualScreens([
      [keyRow(1, "user"), keyRow(2, "assistant")],
      [keyRow(3, "user"), keyRow(4, "assistant")],
      [keyRow(5, "user")],
    ]);

    const messages = await readMessages(view, settleNow);

    expect(messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
      "user",
    ]);
    expect(messages.map((message) => message.text)).toEqual([
      "第 1 问",
      "第 2 答",
      "第 3 问",
      "第 4 答",
      "第 5 问",
    ]);
    expect(view.scrollTop).toBe(0); // 归位，别把人的页面留在半空
  });

  it("滚不动（一屏装得下）时扫一遍就停，不会空转", async () => {
    const view = virtualScreens([[keyRow(1, "user")]]);

    expect(await readMessages(view, settleNow)).toEqual([{ role: "user", text: "第 1 问" }]);
  });

  it("内容超长却一步都滚不动 = 滚动层认错了，当场抛——别把首屏当全量交上去", async () => {
    const host = document.createElement("div");
    host.innerHTML = keyRow(1, "user");
    const writes: number[] = [];
    const view: ListViewport = {
      querySelectorAll: (selector: string) => host.querySelectorAll(selector),
      get scrollTop(): number {
        return 0; // 写得进去，位置不前进：不是滚动容器
      },
      set scrollTop(value: number) {
        writes.push(value);
      },
      get clientHeight(): number {
        return 100;
      },
      get scrollHeight(): number {
        return 9_999; // 内容确实超长
      },
    };

    await expect(readMessages(view, settleNow)).rejects.toThrow("滚不动消息列表");
    expect(writes).toContain(100); // 真试过往下滚，不是一上来就卡住
  });

  it("只读最后一条：跳到底扫那一屏就够", async () => {
    const view = virtualScreens([[keyRow(1, "user")], [keyRow(2, "assistant"), keyRow(3, "user")]]);

    expect(await readLast(view, settleNow)).toEqual({ role: "user", text: "第 3 问" });
    expect(view.scrollTop).toBe(0);
  });

  it("scrollTop 写在真的会滚那一层——两层都能滚时用最里层", async () => {
    document.body.innerHTML = conversationHtml();
    const itemWrites = stubLayer(document.querySelector(".ds-virtual-list-items")!, "auto", 100);
    const listWrites = stubLayer(document.querySelector(".ds-virtual-list")!, "auto", 100);

    const result = await listMessages(frameOf("messages.list"));

    expect(result.messages).toHaveLength(2);
    expect(itemWrites).toEqual([0, 100, 200, 0]); // 真滚过，最后归位
    expect(listWrites).toEqual([]); // 外层那一下都没碰
  });

  it("内层内容溢出却 overflow:visible（滚不动的假象）→ 跳过它，用外层", async () => {
    document.body.innerHTML = conversationHtml();
    // 真机上 `.ds-virtual-list` 是 flex 容器、里面那层撑着全部行，两层都可能报溢出。
    const itemWrites = stubLayer(document.querySelector(".ds-virtual-list-items")!, "visible", 100);
    const listWrites = stubLayer(document.querySelector(".ds-virtual-list")!, "auto", 100);

    await listMessages(frameOf("messages.list"));

    expect(itemWrites).toEqual([]); // 写它就是空操作，识破了
    expect(listWrites).toEqual([0, 100, 200, 0]);
  });
});

/** 给某一层钉上「内容 300px、视口 client px」，并记下 `scrollTop` 被写过什么。 */
function stubLayer(element: Element, overflowY: string, client: number): number[] {
  const writes: number[] = [];
  let top = 0;
  element.setAttribute("style", `overflow-y: ${overflowY}`);
  Object.defineProperties(element, {
    scrollTop: {
      configurable: true,
      get: (): number => top,
      set: (value: number) => {
        top = value;
        writes.push(value);
      },
    },
    scrollHeight: { configurable: true, get: (): number => 300 },
    clientHeight: { configurable: true, get: (): number => client },
  });
  return writes;
}
