import { browser } from "wxt/browser";
import { defineContentScript } from "wxt/utils/define-content-script";

import {
  actionListener,
  askRequestMessage,
  parseAskResponse,
  parseChainMessage,
  resultMessage,
  unreachableResult,
  type ActionRoster,
  type QuestionMessage,
} from "../src/lib/channel";
import {
  clearComposer,
  clickSend,
  newChat,
  pressEnter,
  readComposer,
  readPageState,
  typeComposer,
} from "../src/lib/page";
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
          askRequestMessage(question.id, question.question),
        );
        const parsed = parseAskResponse(response);
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

    // 两个内容脚本谁先谁后都可能：页面世界开口要就答一次，这边自己上来也报一次。
    window.addEventListener("message", (event) => {
      if (event.source !== window) return;

      const chain = parseChainMessage(event.data);
      if (chain?.kind === "question") {
        void forwardToRelay(chain);
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
    };

    // background 打过来的动作帧（走 `tabs.sendMessage`）：当场交回一个 ActionOutcome；
    // 认不出的信封一声不吭，不抢 ask 那条路的消息。
    browser.runtime.onMessage.addListener(actionListener(ACTION_ROSTER));

    // 总开关改了立刻广播，刷新与重启靠 storage 自己保持。
    browser.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local") return;
      if (!(TOGGLE_STORAGE_KEY in changes)) return;
      void broadcast();
    });

    await broadcast();
  },
});
