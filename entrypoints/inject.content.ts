import { defineContentScript } from "wxt/utils/define-content-script";

import { isOutgoingChatRequest, rewriteOutgoingBody } from "../src/lib/inject";
import { parseToggleMessage, wantStateMessage } from "../src/lib/toggle";

type XhrTarget = { readonly method: string; readonly url: string };

/**
 * 协议说明注入的页面世界一侧：把 `fetch` 与 `XMLHttpRequest` 包一层，
 * 在请求体离开页面之前的最后一处改写它——那里拿到的就是即将发送的完整消息文本。
 *
 * 总开关关着时不包任何东西：不接管、不注入、不改页面任何东西；
 * 打开才包，关回去就把原样还回去。开关状态从隔离世界的消息里来（它才有 storage）。
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

    const xhrTargets = new WeakMap<XMLHttpRequest, XhrTarget>();

    /** 判断逻辑在 src/lib/inject.ts，这里只认它那句「null 就原样放行」。 */
    const rewriteBody = (body: string, method: string, url: string): string | null => {
      if (!isOutgoingChatRequest(method, url)) return null;
      return rewriteOutgoingBody(body);
    };

    function install(): void {
      if (installed) return;
      installed = true;
      originalFetch = window.fetch;
      originalOpen = XMLHttpRequest.prototype.open;
      originalSend = XMLHttpRequest.prototype.send;

      window.fetch = function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
        const url = input instanceof Request ? input.url : String(input);
        const method = init?.method ?? (input instanceof Request ? input.method : "GET");
        if (init === undefined || typeof init.body !== "string") {
          return originalFetch.call(window, input, init);
        }
        const nextBody = rewriteBody(init.body, method, url);
        if (nextBody === null) return originalFetch.call(window, input, init);
        return originalFetch.call(window, input, { ...init, body: nextBody });
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
      console.log(
        `[ds-] 总开关${next ? "打开" : "关闭"}，协议说明${next ? "开始注入" : "不再注入"}`,
      );
    }

    window.addEventListener("message", (event) => {
      if (event.source !== window) return;
      const message = parseToggleMessage(event.data);
      if (message?.kind === "state") apply(message.enabled);
    });

    // 两个内容脚本谁先谁后都可能：这边开口要一次，那边自己也会报一次。
    window.postMessage(wantStateMessage(), "*");
  },
});
