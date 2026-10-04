/**
 * 本页**角色账本**（ADR-0014）：页面世界从出站请求体里读到的整段对话（角色 + 正文）。
 *
 * 读对话（`messages.*`）判角色时**先查这里**——`role` 是站点消息模型自带的数据
 * （站点代码里叫 `chat_message_role`），比从 DOM 判硬：站点换版、两套渲染都不影响它。
 *
 * 只在本页内存里：页面一重载就空（那时退回 DOM 两层）。不落盘、不上报 background。
 */

import type { ChatPayloadMessage } from "./channel";
import type { MessageRole } from "./messages";

/** 比对用的指纹：折叠空白、去首尾（DOM 里的排版空白与载荷里的原文对不上，先抹平）。 */
function fingerprint(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** 太短的指纹不做「包含」匹配——几个字的消息太容易误撞。 */
const MIN_CONTAIN_MATCH = 8;

const roles = new Map<string, MessageRole>();

/** 记一段对话：后到的覆盖先到的（同一条文本重复出现时留最后一次）。 */
export function recordChat(messages: readonly ChatPayloadMessage[]): void {
  for (const message of messages) {
    const key = fingerprint(message.text);
    if (key === "") continue;
    roles.set(key, message.role);
  }
}

/**
 * 按正文查角色（**不猜**）：先精确比指纹；再退一步——DOM 行里常混进工具条那类零碎
 * （「复制」「下载」），于是看账本里的哪条正文**被这一行包住**。都没有回 `null`，
 * 交给下一层（标记 / 气泡）。
 */
export function ledgerRole(text: string): MessageRole | null {
  const key = fingerprint(text);
  if (key === "") return null;
  const exact = roles.get(key);
  if (exact !== undefined) return exact;
  for (const [known, role] of roles) {
    if (known.length >= MIN_CONTAIN_MATCH && key.includes(known)) return role;
  }
  return null;
}

/** 只给测试与页面重载用：清空账本。 */
export function clearLedger(): void {
  roles.clear();
}
