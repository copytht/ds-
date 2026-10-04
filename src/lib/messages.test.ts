import { describe, expect, it } from "vitest";

import type { ActionFrame } from "./action";
import {
  lastMessage,
  listMessages,
  readLast,
  readMessages,
  readRow,
  roleOf,
  type ListViewport,
  type StyleProbe,
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

  it("不是消息行的行跳过；认不出角色的消息行带 unknown——都不猜角色", () => {
    document.body.innerHTML = `
      <div class="ds-virtual-list">
        <div data-virtual-list-item-key="1"><span>日期分隔条</span></div>
        <div data-virtual-list-item-key="2"><div class="ds-message"><div>没有可折叠文本</div></div></div>
      </div>`;
    expect(readRow(rowAt(0))).toBeNull(); // 不是消息行（这页有 .ds-message，唯独它没有）
    expect(readRow(rowAt(1))).toEqual({ role: "unknown", text: "没有可折叠文本" });
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

  it("挂着行但认不出角色：如实带 unknown（不猜、不装空对话）", async () => {
    document.body.innerHTML = `
      <div class="ds-virtual-list">
        <div data-virtual-list-item-key="1"><div class="ds-message"><div>认不出</div></div></div>
      </div>`;

    expect(await listMessages(frameOf("messages.list"))).toEqual({
      messages: [{ role: "unknown", text: "认不出" }],
    });
    expect(await lastMessage(frameOf("messages.last"))).toEqual({
      messages: [{ role: "unknown", text: "认不出" }],
    });
  });
});

/**
 * 角色三层里的**渲染层**（气泡）：jsdom 不做布局，`getComputedStyle` / `getBoundingClientRect`
 * 拿不到真值，所以用替身探测口，把「算出来的样式 / 几何」写在 `data-*` 上喂进去。
 * 数字照真机量的（`10-04-read-conversation/research/role-bubble.md`）。
 */
const attributeProbe: StyleProbe = {
  style: (el) => ({
    backgroundColor: el.getAttribute("data-bg") ?? "rgba(0, 0, 0, 0)",
    borderRadius: el.getAttribute("data-radius") ?? "0px",
  }),
  rect: (el) => ({
    left: Number(el.getAttribute("data-left") ?? "0"),
    right: Number(el.getAttribute("data-right") ?? "0"),
  }),
};

/** 造一行：行占 0..752，里面放一块「绘制出来的东西」（或什么都不放）。 */
function bubbleRow(inner: string, rowLeft = 0, rowRight = 752): Element {
  document.body.innerHTML = `
    <div class="ds-virtual-list"><div class="ds-virtual-list-visible-items">
      <div data-virtual-list-item-key="1" data-left="${rowLeft}" data-right="${rowRight}">
        ${inner}
      </div>
    </div></div>`;
  return document.querySelector("[data-virtual-list-item-key]") as Element;
}

describe("角色：渲染层（气泡）", () => {
  it("用户：不满宽的圆角块（真机 22px、贴右）", () => {
    const row = bubbleRow(
      '<div data-bg="rgb(237, 243, 254)" data-radius="22px" data-left="88" data-right="752">继续</div>',
    );
    expect(roleOf(row, attributeProbe)).toBe("user");
  });

  it("用户（长到满宽）：还有头像圆兜着", () => {
    const row = bubbleRow(
      '<div data-bg="rgb(237, 243, 254)" data-radius="22px" data-left="0" data-right="752">长消息</div>' +
        '<div data-bg="rgb(255, 255, 255)" data-radius="100px" data-left="710" data-right="740"></div>',
    );
    expect(roleOf(row, attributeProbe)).toBe("user");
  });

  it("助手：整宽素文，什么都不画", () => {
    expect(roleOf(bubbleRow("<p>答案</p>"), attributeProbe)).toBe("assistant");
  });

  it("助手带代码块：满宽 12px 的块不算气泡（真机数字）", () => {
    const row = bubbleRow(
      '<div data-bg="rgb(249, 250, 251)" data-radius="12px" data-left="0" data-right="752">' +
        '<pre>{"tool": "ls"}</pre></div>',
    );
    expect(roleOf(row, attributeProbe)).toBe("assistant");
  });

  it("没有布局（行宽为 0）：判不了，回 unknown——不猜", () => {
    expect(roleOf(bubbleRow("<p>答案</p>", 0, 0), attributeProbe)).toBe("unknown");
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

/**
 * 挂载要迟几帧才跟上的假虚拟列表——**这才是真机那次超时的根因**（2026-10-02）：
 * 一帧一步地扫 80 屏只收到 50 条，而对话有 385 条。中间那些屏就这么被跳过去了，
 * 不是扫得慢，是读的时候那一屏还没挂上。
 *
 * `lag` 是挂载要等几帧；期间再被叫去别的位置，前面那一屏就永远看不到了。
 */
function laggingScreens(
  screens: string[][],
  lag: number,
): {
  view: ListViewport;
  settle: () => Promise<void>;
} {
  const HEIGHT = 100;
  const host = document.createElement("div");
  let index = 0;
  let target = 0;
  let left = 0;
  const paint = (): void => {
    host.innerHTML = screens[index]?.join("") ?? "";
  };
  paint();
  const clamp = (value: number): number =>
    Math.min(screens.length - 1, Math.max(0, Math.round(value / HEIGHT)));
  const view: ListViewport = {
    get scrollTop(): number {
      return index * HEIGHT;
    },
    set scrollTop(value: number) {
      target = clamp(value);
      left = lag;
    },
    get clientHeight(): number {
      return HEIGHT;
    },
    get scrollHeight(): number {
      return screens.length * HEIGHT;
    },
    querySelectorAll: (selector: string) => host.querySelectorAll(selector),
  };
  const settle = async (): Promise<void> => {
    if (left > 0) left -= 1;
    if (left === 0 && target !== index) {
      index = target;
      paint();
    }
  };
  return { view, settle };
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

  it("挂载迟到的屏也要收得到——一帧一步会把中间的屏跳过去（真机那次超时的根因）", async () => {
    const screens = [
      [keyRow(0, "user")],
      [keyRow(1, "assistant")],
      [keyRow(2, "user")],
      [keyRow(3, "assistant")],
      [keyRow(4, "user")],
    ];
    const { view, settle } = laggingScreens(screens, 3);

    const result = await readMessages(view, settle);

    expect(result.map((m) => m.text)).toEqual([
      "第 0 问",
      "第 1 答",
      "第 2 问",
      "第 3 答",
      "第 4 问",
    ]);
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

  it("内层 clientHeight 为 0（height:0 + overflow:hidden 的包装层）→ 跳过它，用外层", async () => {
    // 看不见的一屏扫不动：每轮只挪 1px。留着这条是防这种层混进来。
    document.body.innerHTML = conversationHtml();
    const itemWrites = stubLayer(document.querySelector(".ds-virtual-list-items")!, "hidden", 0);
    const listWrites = stubLayer(document.querySelector(".ds-virtual-list")!, "auto", 100);

    const result = await listMessages(frameOf("messages.list"));

    expect(result.messages).toHaveLength(2);
    expect(itemWrites).toEqual([]); // 一屏都看不见，写它等于每轮挪 1px
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
