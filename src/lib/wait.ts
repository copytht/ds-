import { ACTION_ERROR_PAGE_CHANGED, ACTION_ERROR_TIMEOUT, PageError } from "./action";
import type { ActionFrame } from "./action";
import { parseSendFence } from "./fence";
import {
  ROW_SELECTOR,
  conversation,
  keysOf,
  nextFrame,
  readRow,
  settleUntilMounted,
  type ListViewport,
  type Message,
} from "./messages";
import { hasReplyAnchor } from "./reply";

/**
 * 等动作（#22）：等页面模型排出围栏（`wait.fence`）、等一条新的
 * 回灌落地（`wait.reply`）。它们是「页面指挥」回路在 agent 侧的
 * 收口——发完问题之后，agent 不用自己轮询读对话来盯进展。
 *
 * **基线**：动作一到就先跳到底，记下此刻挂载行的最大行 key
 * （`data-virtual-list-item-key`，会话内稳定的序号）；之后只认
 * key 更大的行——视口里重新挂出的旧行（滚动造成的）不算新消息，
 * 旧回灌也就不会被误认成「这一回的答复」。
 *
 * **围栏只认闭合的**：`parseSendFence` 对没出完的半截围栏返回
 * null，轮询自然略过——等的是「排完」的围栏，不是排到一半的。
 *
 * **不主动滚**：新消息出来时站点自己把列表滚到底；轮询只扫当前
 * 挂载的行，不去抢滚动条。
 *
 * **预算**：中继推下去等回传的锁是 30s，等待预算默认 25s、可配
 * （`params.timeout`，秒），钳在 [1, 25]——留 5s 余量让结果回得
 * 去（与读对话的扫屏预算同一个理由）。到点回在册的 `timeout`。
 */

/** 轮询节奏：真机挂载一屏约 190ms，500ms 一问足够看见新行。 */
const POLL_INTERVAL_MS = 500;

/** 默认等待预算（秒）：中继 30s 的锁内，留 5s 回传余量。 */
export const DEFAULT_WAIT_SECONDS = 25;
/** 预算上限（秒）：再长就顶到中继的锁上，真失败会被吞成中继的 timeout。 */
export const MAX_WAIT_SECONDS = 25;
/** 预算下限（秒）：0 和负数按「没配」对待会干等，下限 1s 兜底。 */
export const MIN_WAIT_SECONDS = 1;

/** 等待预算：`params.timeout`（秒）可配，非法按默认，钳在上下限之间。 */
export function parseWaitSeconds(frame: ActionFrame): number {
  const wanted = frame.params["timeout"];
  const seconds =
    typeof wanted === "number" && Number.isFinite(wanted)
      ? Math.min(Math.max(wanted, MIN_WAIT_SECONDS), MAX_WAIT_SECONDS)
      : DEFAULT_WAIT_SECONDS;
  return seconds;
}

/**
 * 基线：跳到底、等挂载、记下挂载行的最大行 key。没有一行带合法
 * 数字 key（-1）时，基线之后**任何**合法行都算新消息。
 */
export async function baselineKey(
  view: ListViewport,
  settle: () => Promise<void> = nextFrame,
): Promise<number> {
  const home = view.scrollTop;
  view.scrollTop = view.scrollHeight;
  await settleUntilMounted(view, keysOf(view), settle);
  let max = -1;
  const rows = view.querySelectorAll(ROW_SELECTOR);
  for (let index = 0; index < rows.length; index += 1) {
    const key = Number(rows[index]?.getAttribute("data-virtual-list-item-key"));
    if (Number.isFinite(key) && key > max) max = key;
  }
  view.scrollTop = home;
  return max;
}

/**
 * 轮询视口里挂载的行，返回第一条「key 大于基线、且过 `matches`
 * 判定的消息」；到点没等到回 null。`interval` 可注入，测试不用等
 * 真实的 500ms。
 */
export async function waitUntilNewMessage(
  view: ListViewport,
  baseline: number,
  deadline: number,
  matches: (message: Message) => boolean,
  interval: number = POLL_INTERVAL_MS,
): Promise<Message | null> {
  for (;;) {
    const rows = view.querySelectorAll(ROW_SELECTOR);
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      if (row === undefined) continue;
      const key = Number(row.getAttribute("data-virtual-list-item-key"));
      if (!Number.isFinite(key) || key <= baseline) continue;
      const message = readRow(row);
      if (message !== null && matches(message)) return message;
    }
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

/** 认不出消息列表（新对话、结构变了）：当场说，不装没看见。 */
function viewOrThrow(): ListViewport {
  const view = conversation(document);
  if (view === null) {
    throw new PageError(ACTION_ERROR_PAGE_CHANGED, "没有消息列表可等");
  }
  return view;
}

/** `wait.fence`：等基线之后第一条排出闭合 ```send 围栏的消息。 */
export async function waitFence(frame: ActionFrame): Promise<{ readonly question: string }> {
  const view = viewOrThrow();
  const baseline = await baselineKey(view);
  const deadline = Date.now() + parseWaitSeconds(frame) * 1000;
  const message = await waitUntilNewMessage(
    view,
    baseline,
    deadline,
    (message) => parseSendFence(message.text) !== null,
  );
  if (message === null) {
    throw new PageError(ACTION_ERROR_TIMEOUT, "等围栏超时");
  }
  const question = parseSendFence(message.text);
  // 命中判定本身就要求闭合围栏；这里再取一次，类型上才拿得到字符串。
  if (question === null) {
    throw new PageError(ACTION_ERROR_TIMEOUT, "等围栏超时");
  }
  return { question };
}

/** `wait.reply`：等基线之后第一条首行锚为 `agent:` 的回灌。 */
export async function waitReply(frame: ActionFrame): Promise<{ readonly text: string }> {
  const view = viewOrThrow();
  const baseline = await baselineKey(view);
  const deadline = Date.now() + parseWaitSeconds(frame) * 1000;
  const message = await waitUntilNewMessage(view, baseline, deadline, (message) =>
    hasReplyAnchor(message.text),
  );
  if (message === null) {
    throw new PageError(ACTION_ERROR_TIMEOUT, "等回灌超时");
  }
  return { text: message.text };
}
