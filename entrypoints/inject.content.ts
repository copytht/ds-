import { defineContentScript } from "wxt/utils/define-content-script";

import { detectAskQuestion, extractAssistantAnswer } from "../src/lib/answer";
import { parseChainMessage, questionMessage, type ResultMessage } from "../src/lib/channel";
import { enqueue, newGate, nextOpenAt, release, type Gate } from "../src/lib/gate";
import { isOutgoingChatRequest, rewriteOutgoingBody } from "../src/lib/inject";
import { nextMessageId } from "../src/lib/id";
import { buildReply, hasReplyAnchor, isInjectableReply } from "../src/lib/reply";
import { outsideFences, reportSaid } from "../src/lib/said";
import { parseToggleMessage, wantStateMessage } from "../src/lib/toggle";

type XhrTarget = { readonly method: string; readonly url: string };

/**
 * 页面世界这一侧有两件事（总开关关着时一件都不做：不接管、不注入、不检测、不回灌）：
 *
 * 1. **协议说明注入**：把 `fetch` 与 `XMLHttpRequest` 包一层，在请求体离开页面之前改写它。
 * 2. **回灌链**：同一次包下来的**响应体**就是检测点（模型回答的唯一来源）→ 认出 ```say 围栏 →
 *    问题交给隔离世界去打中继 → 结果进**唯一出站口**排队，出站窗口到点放行（ADR-0002）→
 *    回灌作为一条真实用户消息发进当前会话。
 *
 * 失败一律不进对话流：中继没问成时这里只留一行日志，页面里不出现任何新消息。
 */
export default defineContentScript({
  world: "MAIN",
  matches: ["https://chat.deepseek.com/*"],
  runAt: "document_start",
  main() {
    // 现取不预存：要包的是「包的那一刻页面正在用的那一版」，还原的也是它。
    let originalFetch!: typeof window.fetch;
    let originalOpen!: typeof XMLHttpRequest.prototype.open;
    let originalSend!: typeof XMLHttpRequest.prototype.send;
    let installed = false;
    let enabled = false;

    /** 唯一出站口：回灌内容在这里排队，出站窗口到点才放行。 */
    let gate: Gate = newGate();
    let flushTimer: number | null = null;

    const xhrTargets = new WeakMap<XMLHttpRequest, XhrTarget>();
    const watchingXhrs = new WeakSet<XMLHttpRequest>();

    /** 判断逻辑在 src/lib/inject.ts，这里只认它那句「null 就原样放行」。 */
    const rewriteBody = (body: string, method: string, url: string): string | null => {
      if (!isOutgoingChatRequest(method, url)) return null;
      const next = rewriteOutgoingBody(body);
      if (next !== null) console.log("[ds-] 已把协议说明拼到这条消息开头");
      return next;
    };

    /** 排下一次开窗：队列空着就不排。 */
    function scheduleFlush(): void {
      const at = nextOpenAt(gate);
      if (at === null) return;
      if (flushTimer !== null) window.clearTimeout(flushTimer);
      flushTimer = window.setTimeout(flush, Math.max(0, at - Date.now()));
    }

    /** 出站窗口开一次，把队列一次性放行；每条都走同一条发送路径。 */
    function flush(): void {
      flushTimer = null;
      const step = release(gate, Date.now(), Math.random);
      gate = step.gate;
      for (const message of step.released) {
        void sendToPage(message)
          .then((sent) => {
            console.log(
              sent ? "[ds-] 回灌已作为用户消息发出" : "[ds-] 回灌没有发出去，页面里没有新消息",
            );
          })
          .catch((error) => {
            console.log("[ds-] 回灌发送出岔，页面里没有新消息", error);
          });
      }
      if (gate.queue.length > 0) scheduleFlush();
    }

    /** 中继给了 status: ok 的载荷才排进队列；单来回，不重试、无兜底。 */
    function handleResult(result: ResultMessage): void {
      if (!enabled) return;
      if (!isInjectableReply(result.payload)) {
        const error = result.payload.status === "error" ? result.payload.error : "unknown";
        console.log(`[ds-] 中继没问成（${error}），失败不进对话流`);
        return;
      }
      gate = enqueue(gate, buildReply(result.payload), Date.now(), Math.random);
      scheduleFlush();
    }

    /** 检测：只从「发消息那条出站的响应体」里认围栏，认出就把问题交出去。 */
    function detect(raw: string): void {
      if (!enabled) return;
      const question = detectAskQuestion(raw);
      // **围栏之外的话**一律报给协调者：有围栏时围栏转子 agent，围栏以外那些别的话不能被吞掉。
      // 回灌自己（首行是 `agent:`）不算：那是桥送回去的，再报就成了回声。
      const said = outsideFences(extractAssistantAnswer(raw));
      if (said !== "" && !hasReplyAnchor(said)) void reportSaid(said);
      if (question === null) {
        // 静默分支曾让「围栏在、但形状认不出」无法定位，这里只在真有 say 字样时吭声。
        if (raw.includes("```say")) {
          console.log(`[ds-] 响应里有 \`\`\`say 字样却没认出围栏（${raw.length} 字）`);
        }
        return;
      }
      const id = nextMessageId("ask");
      console.log(`[ds-] 认出 say 围栏（${id}），问题交给中继`);
      window.postMessage(questionMessage(id, question), "*");
    }

    /** 读响应体；读不出来就这轮不检测，不猜。 */
    async function watchResponse(response: Response): Promise<void> {
      try {
        const raw = await response.text();
        // 与「检测没跑」区分：跑没跑先有个数。
        console.log(`[ds-] 读到出站响应（${raw.length} 字）`);
        detect(raw);
      } catch (error) {
        console.log("[ds-] 响应读不出来，这轮不检测", error);
      }
    }

    /** XHR 的响应体：文本直接读，别的类型认得出结构就还原成原文。 */
    function readXhrResponse(xhr: XMLHttpRequest): string | null {
      try {
        if (xhr.responseType === "" || xhr.responseType === "text") return xhr.responseText;
        const response = xhr.response;
        if (typeof response === "string") return response;
        if (response !== null && typeof response === "object") return JSON.stringify(response);
      } catch {
        return null;
      }
      return null;
    }

    function install(): void {
      if (installed) return;
      installed = true;
      originalFetch = window.fetch;
      originalOpen = XMLHttpRequest.prototype.open;
      originalSend = XMLHttpRequest.prototype.send;

      window.fetch = function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
        const url = input instanceof Request ? input.url : String(input);
        const method = init?.method ?? (input instanceof Request ? input.method : "GET");
        const outgoing = isOutgoingChatRequest(method, url);

        const bodyText = init !== undefined && typeof init.body === "string" ? init.body : null;
        const nextBody = outgoing && bodyText !== null ? rewriteOutgoingBody(bodyText) : null;
        if (nextBody !== null) console.log("[ds-] 已把协议说明拼到这条消息开头");
        const requestInit =
          nextBody !== null && init !== undefined ? { ...init, body: nextBody } : init;

        const request = originalFetch.call(window, input, requestInit);
        if (!outgoing) return request;
        // 模型的回答只走这条路回来：克隆一份自己读，页面那一份照常流走。
        return request.then((response) => {
          void watchResponse(response.clone());
          return response;
        });
      };

      XMLHttpRequest.prototype.open = function (
        method: string,
        url: string | URL,
        async?: boolean,
        username?: string | null,
        password?: string | null,
      ): void {
        xhrTargets.set(this, { method, url: String(url) });
        // 三参形式与两参形式等价（async 缺省即 true），一个出口够了。
        originalOpen.call(this, method, url, async ?? true, username, password);
      };

      XMLHttpRequest.prototype.send = function (
        body?: Document | XMLHttpRequestBodyInit | null,
      ): void {
        const target = xhrTargets.get(this);
        if (target !== undefined && !watchingXhrs.has(this)) {
          watchingXhrs.add(this);
          this.addEventListener("loadend", () => {
            if (!isOutgoingChatRequest(target.method, target.url)) return;
            const raw = readXhrResponse(this);
            if (raw !== null) detect(raw);
          });
        }
        if (target !== undefined && typeof body === "string") {
          const nextBody = rewriteBody(body, target.method, target.url);
          if (nextBody !== null) {
            originalSend.call(this, nextBody);
            return;
          }
        }
        originalSend.call(this, body);
      };
    }

    function uninstall(): void {
      if (!installed) return;
      installed = false;
      window.fetch = originalFetch;
      XMLHttpRequest.prototype.open = originalOpen;
      XMLHttpRequest.prototype.send = originalSend;
    }

    function apply(next: boolean): void {
      if (next === enabled) return;
      enabled = next;
      if (next) install();
      else uninstall();
      if (!next) {
        // 关掉时整条链一起作废：队列清空、定时器撤掉；检测随包装一起卸掉。
        if (flushTimer !== null) {
          window.clearTimeout(flushTimer);
          flushTimer = null;
        }
        gate = newGate();
      }
      console.log(
        `[ds-] 总开关${next ? "打开" : "关闭"}，协议说明${next ? "开始注入" : "不再注入"}，回灌链${next ? "开始工作" : "整条不再工作"}`,
      );
    }

    window.addEventListener("message", (event) => {
      if (event.source !== window) return;

      const chain = parseChainMessage(event.data);
      if (chain?.kind === "result") {
        handleResult(chain);
        return;
      }

      const toggle = parseToggleMessage(event.data);
      if (toggle?.kind === "state") apply(toggle.enabled);
    });

    // 两个内容脚本谁先谁后都可能：这边开口要一次，那边自己也会报一次。
    window.postMessage(wantStateMessage(), "*");
  },
});

/* -------------------------------------------------------------------------- */
/* 回灌发送点：把消息交给站点自己那条发消息的路径                                */
/* -------------------------------------------------------------------------- */

const COMPOSER_SELECTORS = ["textarea", '[contenteditable="true"]'];

const SEND_BUTTON_SELECTORS = [
  'button[aria-label*="send" i]',
  'button[aria-label*="发送"]',
  'button[data-testid*="send" i]',
  'button[data-testid*="发送"]',
  'button[title*="send" i]',
  'button[title*="发送"]',
];

/**
 * 回灌作为一条真实用户消息发进当前会话：把消息填进站点自己的输入框、触发它原生的发送，
 * 于是这条消息走的与 #12 注入同一条路（同一个 `CHAT_SEND_PATH` 闸门内的那次发送）。
 * 返回有没有真的发出去；发不出去就把输入框还原，页面里不留半截东西。
 */
async function sendToPage(message: string): Promise<boolean> {
  const composer = pickComposer();
  if (composer === null) {
    console.log("[ds-] 没找到站点的输入框，这轮回灌作废");
    return false;
  }

  const before = readComposer(composer);
  if (!writeComposer(composer, message)) {
    console.log("[ds-] 输入框写不进去，这轮回灌作废");
    return false;
  }

  if (await triggerSend(composer)) return true;

  if (readComposer(composer).includes(message)) writeComposer(composer, before);
  return false;
}

/** 挑站点的输入框：看得见、能写的优先 textarea，其次可编辑区；同级里挑面积最大的。 */
function pickComposer(): HTMLElement | null {
  for (const selector of COMPOSER_SELECTORS) {
    let best: HTMLElement | null = null;
    let bestArea = -1;
    for (const candidate of document.querySelectorAll<HTMLElement>(selector)) {
      if (!isWritable(candidate)) continue;
      const rect = candidate.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (area > bestArea) {
        best = candidate;
        bestArea = area;
      }
    }
    if (best !== null) return best;
  }
  return null;
}

function isWritable(element: HTMLElement): boolean {
  if (!element.isConnected || element.getClientRects().length === 0) return false;
  if (element instanceof HTMLTextAreaElement) return !element.disabled && !element.readOnly;
  return element.isContentEditable;
}

function readComposer(element: HTMLElement): string {
  if (element instanceof HTMLTextAreaElement) return element.value;
  return element.textContent ?? "";
}

/** 写值走原生 setter：站点的受控组件才认得这次改动（只 dispatch 事件不算改过）。 */
function writeComposer(element: HTMLElement, text: string): boolean {
  if (element instanceof HTMLTextAreaElement) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    if (setter === undefined) return false;
    setter.call(element, text);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }
  if (element.isContentEditable) {
    element.textContent = text;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }
  return false;
}

async function triggerSend(composer: HTMLElement): Promise<boolean> {
  dispatchEnter(composer);
  if (await waitForSend(composer, 600)) return true;

  const button = findSendButton(composer);
  if (button === null) return false;
  button.click();
  return waitForSend(composer, 1200);
}

/** Enter 是站点的发送键；keyCode / which 自己补上，页面里的老判断也认。 */
function dispatchEnter(composer: HTMLElement): void {
  const event = new KeyboardEvent("keydown", {
    key: "Enter",
    code: "Enter",
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, "keyCode", { value: 13 });
  Object.defineProperty(event, "which", { value: 13 });
  composer.dispatchEvent(event);
}

function findSendButton(composer: HTMLElement): HTMLElement | null {
  for (const selector of SEND_BUTTON_SELECTORS) {
    const candidate = document.querySelector<HTMLElement>(selector);
    if (candidate === null) continue;
    if (candidate.getClientRects().length === 0) continue;
    if (candidate.hasAttribute("disabled")) continue;
    return candidate;
  }
  const form = composer.closest("form");
  return form?.querySelector<HTMLElement>("button:not([disabled])") ?? null;
}

/** 发出去的标志：输入框被站点清空。 */
function waitForSend(composer: HTMLElement, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const tick = (): void => {
      if (readComposer(composer).trim() === "") {
        resolve(true);
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        resolve(false);
        return;
      }
      window.setTimeout(tick, 100);
    };
    tick();
  });
}
