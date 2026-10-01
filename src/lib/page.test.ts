import { describe, expect, it } from "vitest";

import { fixtureCases, type ActionCase } from "./fixtures";
import {
  clearComposer,
  clickSend,
  findSendButton,
  newChat,
  pressEnter,
  readComposer,
  readPageState,
  SEND_SELECTOR,
  typeComposer,
} from "./page";

const FRAME = {
  type: "action",
  id: "p-1",
  action: "page.state",
  params: {},
  target: "42",
} as const;

describe("page.state 执行器", () => {
  it("读当前地址、标题、写作框在不在", () => {
    document.title = "DeepSeek - 深度求索";
    document.body.innerHTML = "<textarea></textarea>";

    const state = readPageState(FRAME);

    expect(state.url).toBe(location.href);
    expect(state.title).toBe("DeepSeek - 深度求索");
    expect(state.composerPresent).toBe(true);
  });

  it("没有写作框时 composerPresent=false", () => {
    document.body.innerHTML = "<div>无框</div>";

    expect(readPageState(FRAME).composerPresent).toBe(false);
  });

  it("contenteditable 也算写作框", () => {
    document.body.innerHTML = '<div contenteditable="true"></div>';

    expect(readPageState(FRAME).composerPresent).toBe(true);
  });

  it("result 的键与共享 fixture 的 page.state 样例一致（TS 与 Python 共读）", () => {
    const sample = fixtureCases<ActionCase>("action.json").find(
      ({ name }) => name === "page.state 成功",
    )?.response;
    if (!sample || !sample.ok) throw new Error("fixture 里没有 page.state 成功样例");

    document.title = "t";
    document.body.innerHTML = "";

    expect(Object.keys(readPageState(FRAME)).sort()).toEqual(
      Object.keys(sample.result as object).sort(),
    );
  });
});

describe("composer.* 执行器", () => {
  const typeFrame = (text: unknown) =>
    ({ ...FRAME, action: "composer.type", params: { text } }) as const;

  it("读得到框里的字", () => {
    document.body.innerHTML = "<textarea>写了一半</textarea>";

    expect(readComposer(FRAME)).toEqual({ text: "写了一半" });
  });

  it("写进去的是原生 setter + 冒泡 input（React 受控输入的写法），且不发送", () => {
    document.body.innerHTML = "<textarea></textarea>";
    const el = document.querySelector("textarea") as HTMLTextAreaElement;
    const seen: string[] = [];
    el.addEventListener("input", (event) => seen.push((event.target as HTMLTextAreaElement).value));

    typeComposer(typeFrame("你好"));

    expect(el.value).toBe("你好");
    expect(seen).toEqual(["你好"]); // 那次 input 事件真派了、也冒泡到监听者
  });

  it("params.text 不是字符串就写空", () => {
    document.body.innerHTML = "<textarea>旧字</textarea>";
    const el = document.querySelector("textarea") as HTMLTextAreaElement;

    typeComposer(typeFrame(42));

    expect(el.value).toBe("");
  });

  it("清空框里的字", () => {
    document.body.innerHTML = "<textarea>旧字</textarea>";
    const el = document.querySelector("textarea") as HTMLTextAreaElement;

    clearComposer(FRAME);

    expect(el.value).toBe("");
  });

  it("没有写作框就抛（由收信那层折成失败码）", () => {
    document.body.innerHTML = "<div>无框</div>";

    expect(() => typeComposer(typeFrame("x"))).toThrow();
    expect(() => clearComposer(FRAME)).toThrow();
  });
});

describe("send.* 执行器", () => {
  const SEND = 'div[role="button"].ds-button--primary.ds-button--filled.ds-button--circle';

  // jsdom 不做布局，所有元素的 getClientRects 都是空——测试里手工补一个盒子。
  const stubBox = (el: Element): void => {
    (el as HTMLElement).getClientRects = () => [{ width: 1, height: 1 }] as unknown as DOMRectList;
  };

  it("findSendButton：在且没禁用就回它", () => {
    document.body.innerHTML = `<div role="button" class="${SEND_SELECTOR.split(".").slice(1).join(" ")}"></div>`;
    stubBox(document.querySelector(SEND_SELECTOR) as Element);
    expect(findSendButton()).not.toBeNull();
  });

  it("findSendButton：class 带 ds-button--disabled 回 null", () => {
    document.body.innerHTML = `<div role="button" class="${SEND_SELECTOR.split(".").slice(1).join(" ")} ds-button--disabled"></div>`;
    stubBox(document.querySelector(SEND_SELECTOR) as Element);
    expect(findSendButton()).toBeNull();
  });

  it("findSendButton：没这个键也回 null", () => {
    document.body.innerHTML = "<div>什么都没有</div>";
    expect(findSendButton()).toBeNull();
  });

  it("findSendButton：没渲染出盒子（不可见）也当没找到", () => {
    document.body.innerHTML = `<div role="button" class="${SEND_SELECTOR.split(".").slice(1).join(" ")}"></div>`;
    // 不 stub：jsdom 里天然 getClientRects().length === 0
    expect(findSendButton()).toBeNull();
  });

  it("点站点自己的发送键（设计系统那个圆按钮）", () => {
    document.body.innerHTML = `<textarea></textarea><div role="button" class="${SEND.split(".").slice(1).join(" ")}"></div>`;
    const el = document.querySelector(SEND) as HTMLElement;
    stubBox(el);
    let clicked = 0;
    el.addEventListener("click", () => (clicked += 1));

    clickSend(FRAME);

    expect(clicked).toBe(1);
  });

  it("发送键禁用（class 带 ds-button--disabled）就抛，别假装发过了", () => {
    document.body.innerHTML = `<div role="button" class="${SEND.split(".").slice(1).join(" ")} ds-button--disabled"></div>`;

    expect(() => clickSend(FRAME)).toThrow();
  });

  it("找不到发送键也抛", () => {
    document.body.innerHTML = "<div>什么都没有</div>";

    expect(() => clickSend(FRAME)).toThrow();
  });

  it("回车：在写作框上派 keydown Enter", () => {
    document.body.innerHTML = "<textarea></textarea>";
    const el = document.querySelector("textarea") as HTMLTextAreaElement;
    const keys: string[] = [];
    el.addEventListener("keydown", (event) => keys.push((event as KeyboardEvent).key));

    pressEnter(FRAME);

    expect(keys).toEqual(["Enter"]);
  });
});

describe("chat.new 执行器", () => {
  it("点侧栏那个「开启新对话」条目", () => {
    document.body.innerHTML = '<div tabindex="0">开启新对话</div><div tabindex="0">别的</div>';
    const el = document.querySelector('[tabindex="0"]') as HTMLElement;
    let clicked = 0;
    el.addEventListener("click", () => (clicked += 1));

    newChat(FRAME);

    expect(clicked).toBe(1);
  });

  it("找不到那个条目就抛", () => {
    document.body.innerHTML = "<div>什么都没有</div>";

    expect(() => newChat(FRAME)).toThrow();
  });
});
