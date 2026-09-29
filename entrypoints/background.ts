import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";

import { askResponseMessage, parseAskRequest } from "../src/lib/channel";
import { iconTitle, ICON_COLORS, ICON_SIZE, renderIcon, type IconState } from "../src/lib/icon";
import { nextMessageId } from "../src/lib/id";
import {
  FAILURE_RELAY_UNREACHABLE,
  FAILURE_UNEXPECTED_RESPONSE,
  parseRelayResponse,
  relayAskBody,
  relayAskUrl,
  relayHealthUrl,
  RELAY_HEALTH_TIMEOUT_MS,
  RELAY_TIMEOUT_MS,
} from "../src/lib/relay";
import {
  errorPayload,
  failureNotice,
  type FailureNotice,
  type ReplyPayload,
} from "../src/lib/reply";
import { readToggle, TOGGLE_STORAGE_KEY } from "../src/lib/toggle";

/**
 * background 这一侧干三件事：
 *
 * 1. 打中继（`POST /ask`）——网络层的失败也折成同构载荷，解析只有一条路径；
 * 2. 工具栏图标即状态位：关 / 开且中继可达 / 开但中继不可达，悬停给原因与启动命令；
 * 3. 点击图标切换总开关（总开关本身还是只存在 `storage.local`，默认关）。
 *
 * 不建 options 页、不建 popup、不建面板（spec #9 Out of Scope）。
 */
export default defineBackground(() => {
  /** 图标三态。 */
  let state: IconState = "off";
  /** 不可达时的原因与启动命令，进悬停文案。 */
  let notice: FailureNotice | null = null;

  function badgeText(value: IconState): string {
    if (value === "off") return "关";
    if (value === "on-reachable") return "";
    return "!";
  }

  /** 上图标：先拼悬停文案，再画像素；像素画不出来就退回角标，三态至少还分得开。 */
  async function paintIcon(): Promise<void> {
    await browser.action.setTitle({ title: iconTitle(state, notice) });
    try {
      await browser.action.setIcon({
        imageData: new ImageData(renderIcon(state), ICON_SIZE, ICON_SIZE),
      });
    } catch (error) {
      const [red, green, blue] = ICON_COLORS[state];
      console.log("[ds-] 图标像素画不出来，退回角标", error);
      await browser.action.setBadgeText({ text: badgeText(state) });
      await browser.action.setBadgeBackgroundColor({ color: `rgb(${red}, ${green}, ${blue})` });
    }
  }

  /** 中继的结果 → 图标状态：成功即可达，失败把原因放进失败提示（扩展侧唯一出口）。 */
  function applyOutcome(payload: ReplyPayload): void {
    if (state === "off") return;
    if (payload.status === "ok") {
      state = "on-reachable";
      notice = null;
    } else {
      state = "on-unreachable";
      notice = failureNotice(payload.error);
    }
    void paintIcon();
  }

  async function fetchWithTimeout(
    url: string,
    timeoutMs: number,
    init?: RequestInit,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  /** 探活：开关打开时先看中继在不在（`GET /health`）。 */
  async function pingRelay(): Promise<boolean> {
    try {
      return (await fetchWithTimeout(relayHealthUrl(), RELAY_HEALTH_TIMEOUT_MS)).ok;
    } catch {
      return false;
    }
  }

  /**
   * MV3 的 service worker 闲置 30 秒就会被收走，而中继这一趟可能更久；
   * 答复在途时点一下扩展 API 把它按住，不改任何业务行为。
   */
  function keepAliveWhileAsking(): () => void {
    const timer = setInterval(() => {
      void browser.runtime.getPlatformInfo().catch(() => undefined);
    }, 20_000);
    return () => clearInterval(timer);
  }

  /** 打中继：网络层的失败（没起、被拦、超时）也折成同构载荷。 */
  async function askRelay(question: string): Promise<ReplyPayload> {
    const releaseKeepAlive = keepAliveWhileAsking();
    try {
      const response = await fetchWithTimeout(relayAskUrl(), RELAY_TIMEOUT_MS, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: relayAskBody(question),
      });
      try {
        return parseRelayResponse(response.status, await response.text());
      } catch {
        return errorPayload(FAILURE_UNEXPECTED_RESPONSE);
      }
    } catch {
      return errorPayload(FAILURE_RELAY_UNREACHABLE);
    } finally {
      releaseKeepAlive();
    }
  }

  /** 总开关变了就跟图标：关了即「关」，开了先按可达摆、再探一次中继。 */
  async function syncFromStorage(): Promise<void> {
    const stored = await browser.storage.local.get(TOGGLE_STORAGE_KEY);
    if (!readToggle(stored[TOGGLE_STORAGE_KEY])) {
      state = "off";
      notice = null;
      await paintIcon();
      return;
    }

    state = "on-reachable";
    notice = null;
    await paintIcon();

    const reachable = await pingRelay();
    if (!reachable && state === "on-reachable") {
      state = "on-unreachable";
      notice = failureNotice(FAILURE_RELAY_UNREACHABLE);
      await paintIcon();
    }
  }

  // 点击图标 = 切换总开关（启动命令走悬停文案，见 #13 补充要求）。
  browser.action.onClicked.addListener(() => {
    void (async () => {
      const stored = await browser.storage.local.get(TOGGLE_STORAGE_KEY);
      const next = !readToggle(stored[TOGGLE_STORAGE_KEY]);
      await browser.storage.local.set({ [TOGGLE_STORAGE_KEY]: next });
      console.log(`[ds-] 图标被点，总开关切到${next ? "开" : "关"}`);
    })();
  });

  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (!(TOGGLE_STORAGE_KEY in changes)) return;
    void syncFromStorage();
  });

  // 隔离世界送来的问句：打中继，把同构载荷原路交回。
  browser.runtime.onMessage.addListener((message) => {
    const request = parseAskRequest(message);
    if (request === null) return undefined;
    return askRelay(request.question).then((payload) => {
      applyOutcome(payload);
      return askResponseMessage(request.id, payload);
    });
  });

  browser.runtime.onInstalled.addListener(() => {
    console.log("[ds-] installed, first message id:", nextMessageId("install"));
  });

  void syncFromStorage();
});
