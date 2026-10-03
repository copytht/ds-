import { browser } from "wxt/browser";
import { defineContentScript } from "wxt/utils/define-content-script";

import {
  actionListener,
  accountReportMessage,
  askClearedReportMessage,
  askReportMessage,
  sendRequestMessage,
  pageSessionIdOf,
  parseSendResponse,
  parseChainMessage,
  resultMessage,
  unreachableResult,
  type ActionRoster,
  type AskClearedMessage,
  type AskMessage,
  type QuestionMessage,
} from "../src/lib/channel";
import {
  clearComposer,
  clickSend,
  newChat,
  pressEnter,
  readAccount,
  readComposer,
  readComposerPresent,
  readPageState,
  typeComposer,
} from "../src/lib/page";
import { lastMessage, listMessages } from "../src/lib/messages";
import { waitFence, waitReply } from "../src/lib/wait";
import {
  parseToggleMessage,
  readToggle,
  stateMessage,
  TOGGLE_STORAGE_KEY,
} from "../src/lib/toggle";

/**
 * 隔离世界这一层握着 `browser.*`，页面世界没有：总开关从 `storage.local` 读了广播过去，
 * 页面世界认出的围栏也从这里转给 background 打中继，结果原样送回页面世界。
 *
 * 站点范围在 manifest 权限里钉死为 chat.deepseek.com（权限钉死），
 * 总开关不参与站点判定，只决定页面世界要不要接管。
 */
export default defineContentScript({
  matches: ["https://chat.deepseek.com/*"],
  runAt: "document_start",
  async main() {
    const broadcast = async () => {
      const stored = await browser.storage.local.get(TOGGLE_STORAGE_KEY);
      window.postMessage(stateMessage(readToggle(stored[TOGGLE_STORAGE_KEY])), "*");
    };

    /** 页面世界认出的围栏 → background 打中继 → 结果按同一条信封原路回去。 */
    const forwardToRelay = async (question: QuestionMessage): Promise<void> => {
      try {
        const response = await browser.runtime.sendMessage(
          sendRequestMessage(question.id, question.question, pageSessionIdOf(location.href)),
        );
        const parsed = parseSendResponse(response);
        window.postMessage(
          parsed === null
            ? unreachableResult(question.id)
            : resultMessage(question.id, parsed.payload),
          "*",
        );
      } catch (error) {
        console.log("[ds-] 中继请求没有送出去", error);
        window.postMessage(unreachableResult(question.id), "*");
      }
    };

    /** 网页排了 ask 围栏问人（#26）：报给 background 挂「等人回」。
     * 不等回话——上报是通知，不是请求。 */
    const reportAsk = async (ask: AskMessage): Promise<void> => {
      try {
        await browser.runtime.sendMessage(
          askReportMessage(ask.id, ask.question, pageSessionIdOf(location.href)),
        );
      } catch (error) {
        console.log("[ds-] ask 上报没有送出去", error);
      }
    };

    /** 对话继续了（人答了或模型自己往下走了）：通知 background 清掉「等人回」。 */
    const reportAskCleared = async (cleared: AskClearedMessage): Promise<void> => {
      try {
        await browser.runtime.sendMessage(
          askClearedReportMessage(cleared.id, pageSessionIdOf(location.href)),
        );
      } catch (error) {
        console.log("[ds-] ask 清除没有送出去", error);
      }
    };

    /**
     * 账号处境上报（#2）：总开关开着时 30s 一报。禁言期写路径全断，
     * 悬停得把这层说清（「禁言至何时」）——上报是通知，不等回话。
     */
    const ACCOUNT_REPORT_INTERVAL_MS = 30_000;
    let accountTimer: ReturnType<typeof setInterval> | undefined;
    const reportAccount = async (): Promise<void> => {
      try {
        const account = readAccount(readComposerPresent());
        await browser.runtime.sendMessage(accountReportMessage(account));
        console.log(`[ds-] 账号处境已上报：${account.kind}`);
      } catch {
        // 上报是通知：送不出去不重试，下一报还在。
      }
    };
    const startAccountReporting = (): void => {
      if (accountTimer !== undefined) return;
      void reportAccount();
      accountTimer = setInterval(reportAccount, ACCOUNT_REPORT_INTERVAL_MS);
    };
    const stopAccountReporting = (): void => {
      if (accountTimer === undefined) return;
      clearInterval(accountTimer);
      accountTimer = undefined;
    };

    // 两个内容脚本谁先谁后都可能：页面世界开口要就答一次，这边自己上来也报一次。
    window.addEventListener("message", (event) => {
      if (event.source !== window) return;

      const chain = parseChainMessage(event.data);
      if (chain?.kind === "question") {
        void forwardToRelay(chain);
        return;
      }
      if (chain?.kind === "ask") {
        void reportAsk(chain);
        return;
      }
      if (chain?.kind === "ask-cleared") {
        void reportAskCleared(chain);
        return;
      }

      const message = parseToggleMessage(event.data);
      if (message?.kind === "want-state") void broadcast();
    });

    /**
     * 本地名册：动作名 → 执行器。实现的就往这里加一项，收信那层不用动。
     * 没实现的动作由收信那层当场回 `unknown-action`（不白等中继的 30s）。
     */
    const ACTION_ROSTER: ActionRoster = {
      "page.state": readPageState,
      "composer.read": readComposer,
      "composer.type": typeComposer,
      "composer.clear": clearComposer,
      "send.click": clickSend,
      "send.enter": pressEnter,
      "chat.new": newChat,
      // 只读那批：读对话走 DOM（#20 口径），不碰站点的响应体。
      "messages.list": listMessages,
      "messages.last": lastMessage,
      // 等动作（#22）：等围栏、等回灌——只读，不动写作框。
      "wait.fence": waitFence,
      "wait.reply": waitReply,
    };

    // background 打过来的动作帧（走 `tabs.sendMessage`）：当场交回一个 ActionOutcome；
    // 认不出的信封一声不吭，不抢 send 那条路的消息。
    browser.runtime.onMessage.addListener(actionListener(ACTION_ROSTER));

    // 总开关改了立刻广播，刷新与重启靠 storage 自己保持。
    browser.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local") return;
      if (!(TOGGLE_STORAGE_KEY in changes)) return;
      void broadcast();
      // 账号处境上报跟着总开关走：关着时内容脚本不发声。
      if (readToggle(changes[TOGGLE_STORAGE_KEY].newValue)) {
        startAccountReporting();
      } else {
        stopAccountReporting();
      }
    });

    await broadcast();
    // 总开关现在开着就立刻开始上报（刷新与重启靠 storage 自己保持）。
    const stored = await browser.storage.local.get(TOGGLE_STORAGE_KEY);
    if (readToggle(stored[TOGGLE_STORAGE_KEY])) startAccountReporting();
  },
});
