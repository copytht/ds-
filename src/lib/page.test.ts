import { describe, expect, it } from "vitest";

import { ACTION_ERROR_PAGE_CHANGED, ACTION_ERROR_UNKNOWN, PageError } from "./action";
import { fixtureCases, type ActionCase } from "./fixtures";
import {
  clearComposer,
  clickSend,
  findSendButton,
  findStopButton,
  newChat,
  pressEnter,
  readComposer,
  readPageState,
  readSearch,
  readThink,
  SEND_SELECTOR,
  setSearch,
  setThink,
  stopClick,
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

  // 下面这组是 #2：写作框不在的时候页面自己知道为什么，扩展要认出来，不能空等。
  // 判据的结构与文案是 2026-10-02 从真机页面抄的（`.output/web.html`）。
  const MUTE_ALERT =
    '<div class="ds-alert ds-alert--warning ds-alert--bordered">' +
    '<div class="ds-alert__content">由于违反用户使用规范，你的账号已被禁言至 ' +
    '2026 年 10 月 10 日 20:21，如有疑问请 <div role="button">联系我们。</div></div></div>';

  it("写作框在 → 处境 ready", () => {
    document.body.innerHTML = `<textarea></textarea>${MUTE_ALERT}`;

    expect(readPageState(FRAME).account).toEqual({ kind: "ready" });
  });

  it("没有写作框 + 警示条里有处罚句 → muted，解封时刻按站上写的原样带出来", () => {
    document.body.innerHTML = MUTE_ALERT;

    expect(readPageState(FRAME).account).toEqual({
      kind: "muted",
      until: "2026 年 10 月 10 日 20:21",
    });
  });

  it("会话正文里出现「禁言」不算处罚（那是常事）——只在警示条里认", () => {
    document.body.innerHTML = '<div class="_871cbca">你被禁言了吗</div>';

    expect(readPageState(FRAME).account).toEqual({ kind: "unknown" });
  });

  it("警示条里只提「禁言」不提账号/你 → 不算处罚句", () => {
    document.body.innerHTML = '<div class="ds-alert__content">本周禁言赛制调整，详情见公告</div>';

    expect(readPageState(FRAME).account).toEqual({ kind: "unknown" });
  });

  it("是处罚句但认不出时刻 → 仍算 muted，until 交 null（认不出时间≠没禁）", () => {
    document.body.innerHTML =
      '<div class="ds-alert__content">你的账号已被封禁，解除时间另行通知</div>';

    expect(readPageState(FRAME).account).toEqual({ kind: "muted", until: null });
  });

  it("没有写作框、没处罚句、又在登录页 → signed-out", () => {
    window.history.replaceState(null, "", "/sign_in");
    document.body.innerHTML = "<div>登录</div>";

    expect(readPageState(FRAME).account).toEqual({ kind: "signed-out" });
    window.history.replaceState(null, "", "/");
  });

  it("没有写作框、没处罚句、也不在登录页 → unknown，不猜", () => {
    window.history.replaceState(null, "", "/a/chat/s/abc123");
    document.body.innerHTML = "<div>无框</div>";

    expect(readPageState(FRAME).account).toEqual({ kind: "unknown" });
    window.history.replaceState(null, "", "/");
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

describe("think.* / search.* 开关执行器（#30）", () => {
  const THINK_ON = '<div class="ds-toggle-button" aria-pressed="true">深度思考</div>';
  const THINK_OFF = '<div class="ds-toggle-button" aria-pressed="false">深度思考</div>';

  /** 带 params 的动作帧。 */
  const withParams = (params: Record<string, unknown>) => ({ ...FRAME, params });

  /** 执行器抛的 `PageError` 码；没抛或抛的不是 PageError 一律回 undefined。 */
  function thrownCode(fn: () => unknown): string | undefined {
    try {
      fn();
    } catch (error) {
      return error instanceof PageError ? error.code : undefined;
    }
    return undefined;
  }

  function toggleEl(): HTMLElement {
    return document.querySelector("div.ds-toggle-button") as HTMLElement;
  }

  it("get：aria-pressed=true 才算开着，别的一律算关", () => {
    document.body.innerHTML = THINK_ON;
    expect(readThink(FRAME)).toEqual({ enabled: true });

    document.body.innerHTML = THINK_OFF;
    expect(readThink(FRAME)).toEqual({ enabled: false });
  });

  it("get：tolerant 文字前后空白，只认 div.ds-toggle-button", () => {
    document.body.innerHTML =
      '<div class="other-button" aria-pressed="true">深度思考</div>' +
      '<div class="ds-toggle-button" aria-pressed="false"> 深度思考 </div>';
    expect(readThink(FRAME)).toEqual({ enabled: false });
  });

  it("get：找不到认得的控件 → page-changed（不猜）", () => {
    document.body.innerHTML = '<div class="ds-toggle-button">别的开关</div>';
    expect(thrownCode(() => readThink(FRAME))).toBe(ACTION_ERROR_PAGE_CHANGED);
  });

  it("set：目标态与当前不同 → 点一下，回达成态", () => {
    document.body.innerHTML = THINK_OFF;
    const el = toggleEl();
    let clicked = 0;
    el.addEventListener("click", () => {
      clicked += 1;
      el.setAttribute("aria-pressed", "true"); // 模拟站点拨到目标态
    });

    expect(setThink(withParams({ enabled: true }))).toEqual({ enabled: true });
    expect(clicked).toBe(1);
  });

  it("set：已在目标态 → 不点（幂等，点了反而拨反）", () => {
    document.body.innerHTML = THINK_ON;
    const el = toggleEl();
    let clicked = 0;
    el.addEventListener("click", () => (clicked += 1));

    expect(setThink(withParams({ enabled: true }))).toEqual({ enabled: true });
    expect(clicked).toBe(0);
  });

  it("set：回的是达成态，不是目标态（站点没拨过去就说没拨过去）", () => {
    document.body.innerHTML = THINK_OFF;
    toggleEl().addEventListener("click", () => undefined); // 点了也不变

    expect(setThink(withParams({ enabled: true }))).toEqual({ enabled: false });
  });

  it('set：enabled 非布尔 → unknown-action（别把 "true" 按真值收下）', () => {
    document.body.innerHTML = THINK_OFF;
    expect(thrownCode(() => setThink(withParams({ enabled: "true" })))).toBe(ACTION_ERROR_UNKNOWN);
    expect(thrownCode(() => setThink(withParams({})))).toBe(ACTION_ERROR_UNKNOWN);
  });

  it("search：认「智能搜索」那个开关，与 think 各认各的", () => {
    document.body.innerHTML =
      THINK_ON + '<div class="ds-toggle-button" aria-pressed="false">智能搜索</div>';
    const [think, search] = [...document.querySelectorAll<HTMLElement>("div.ds-toggle-button")] as [
      HTMLElement,
      HTMLElement,
    ];
    let thinkClicked = 0;
    let searchClicked = 0;
    think.addEventListener("click", () => (thinkClicked += 1));
    search.addEventListener("click", () => (searchClicked += 1));

    expect(readSearch(FRAME)).toEqual({ enabled: false });
    // 点了但站点没变 → 回达成态（false），不是目标态（true）。
    expect(setSearch(withParams({ enabled: true }))).toEqual({ enabled: false });
    expect(searchClicked).toBe(1);
    expect(thinkClicked).toBe(0); // 没误点深度思考
  });
});

describe("stop.click 执行器", () => {
  // jsdom 不做布局，所有元素的 getClientRects 都是空——测试里手工补一个盒子。
  const stubBox = (el: Element): void => {
    (el as HTMLElement).getClientRects = () => [{ width: 1, height: 1 }] as unknown as DOMRectList;
  };

  // 真机 2026-10-04 抓的（生成中 / 空闲各一次），原样进下面的常量。
  // 两态的 class 一个不换，只有圆键里的图标不同——所以只能按图标认。
  const STOP_BUTTON_HTML =
    '<div role="button" class="ds-button ds-button--primary ds-button--filled ds-button--circle ds-button--m ds-button--icon-relative-m _52c986b" style="--dsl-button-height: 34px;" tabindex="0"><div class="ds-button__background"></div><div class="ds-button__icon ds-button__icon--last-child"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 4.88C2 3.68009 2 3.08013 2.30557 2.65954C2.40426 2.52371 2.52371 2.40426 2.65954 2.30557C3.08013 2 3.68009 2 4.88 2H11.12C12.3199 2 12.9199 2 13.3405 2.30557C13.4763 2.40426 13.5957 2.52371 13.6944 2.65954C14 3.08013 14 3.68009 14 4.88V11.12C14 12.3199 14 12.9199 13.6944 13.3405C13.5957 13.4763 13.4763 13.5957 13.3405 13.6944C12.9199 14 12.3199 14 11.12 14H4.88C3.68009 14 3.08013 14 2.65954 13.6944C2.52371 13.5957 2.40426 13.4763 2.30557 13.3405C2 12.9199 2 12.3199 2 11.12V4.88Z" fill="currentColor"></path></svg></div></div>';

  const SEND_BUTTON_HTML =
    '<div role="button" class="ds-button ds-button--primary ds-button--filled ds-button--circle ds-button--m ds-button--icon-relative-m ds-button--disabled _52c986b bd74640a" style="--dsl-button-height: 34px;"><div class="ds-button__background"></div><div class="ds-button__icon ds-button__icon--last-child"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8.3125 0.980206C8.66767 1.05312 8.97902 1.2042 9.2627 1.43235C9.48724 1.613 9.73029 1.85795 9.97949 2.10716L14.707 6.8347L13.293 8.24876L9 3.95579V15.0417H7V3.95579L2.70703 8.24876L1.29297 6.8347L6.02051 2.10716C6.26971 1.85795 6.51277 1.613 6.7373 1.43235C6.97662 1.23988 7.28445 1.04404 7.6875 0.980206C7.8973 0.947029 8.1031 0.955183 8.3125 0.980206Z" fill="currentColor"></path></svg></div></div>';

  it("真机回归：生成中那个方块圆键认得出（与发送键同一个元素、同套 class）", () => {
    document.body.innerHTML = STOP_BUTTON_HTML;
    stubBox(document.querySelector(SEND_SELECTOR) as Element);

    expect(findStopButton()).not.toBeNull();
  });

  it("真机回归：空闲时那个箭头圆键不认（别把发送键当停止键）", () => {
    document.body.innerHTML = SEND_BUTTON_HTML;
    stubBox(document.querySelector(SEND_SELECTOR) as Element);

    expect(findStopButton()).toBeNull();
  });

  it("点停止键（真机那个方块圆键）", () => {
    document.body.innerHTML = STOP_BUTTON_HTML;
    const el = document.querySelector(SEND_SELECTOR) as HTMLElement;
    stubBox(el);
    let clicked = 0;
    el.addEventListener("click", () => (clicked += 1));

    stopClick(FRAME);

    expect(clicked).toBe(1);
  });

  it("没渲染出盒子（不可见）也当没找到", () => {
    document.body.innerHTML = STOP_BUTTON_HTML;
    // 不 stub：jsdom 里天然 getClientRects().length === 0
    expect(findStopButton()).toBeNull();
  });

  it("空闲时（圆键是发送箭头）找不到停止键，stopClick 抛，别假装点过了", () => {
    document.body.innerHTML = SEND_BUTTON_HTML;
    stubBox(document.querySelector(SEND_SELECTOR) as Element);

    expect(() => stopClick(FRAME)).toThrow();
  });

  it("站点若给了 aria-label，优先认它（真机上现在没有，先接住）", () => {
    document.body.innerHTML = '<div role="button" aria-label="停止生成"></div>';
    stubBox(document.querySelector('[aria-label="停止生成"]') as Element);

    expect(findStopButton()).not.toBeNull();
  });
});
