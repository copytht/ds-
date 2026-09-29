/**
 * 检测点：模型回答里的 ```ask 围栏（回灌链的第一环）。
 *
 * 取回答的地方固定是「发消息那条出站的响应体」——模型的回答只有这一个来源，
 * 用户自己在页面里敲的围栏在请求侧，进不到这里（spec #9 user story 9）。
 *
 * 响应可能是流式（一行一个 `data:` 载荷）也可能是整块 JSON，两条形状都先还原成
 * 回答正文，再交给 `parseAskFence`；围栏怎么切只有一条路径，这里不自己再切一遍。
 */

import { parseAskFence } from "./fence";

/** 围栏起始的字面量：兜底路径要在原文里找到它，再交给 parseAskFence。 */
const ASK_FENCE_OPENING = "```ask";

/** 只认「正文」类的字符串键；reasoning 之类的过程文本不当成回答。 */
const TEXT_KEYS = new Set(["content", "text"]);
const SKIP_KEYS = new Set(["reasoning", "reasoning_content"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 递归挑出回答正文的字符串片段，按出现顺序追加到 out。 */
function collectText(value: unknown, key: string | null, out: string[]): void {
  if (typeof value === "string") {
    if (key !== null && TEXT_KEYS.has(key)) out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectText(item, key, out);
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [childKey, child] of Object.entries(value)) {
    if (SKIP_KEYS.has(childKey)) continue;
    collectText(child, childKey, out);
  }
}

/** 流式响应里逐行的 `data:` 载荷；`[DONE]`、半行、认不出的一律跳过。 */
function ssePayloads(raw: string): unknown[] {
  const payloads: unknown[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const chunk = line.slice("data:".length).trim();
    if (chunk === "" || chunk === "[DONE]") continue;
    try {
      payloads.push(JSON.parse(chunk));
    } catch {
      // 半行载荷不是一条完整回答，忽略。
    }
  }
  return payloads;
}

/** 从响应原文还原模型的回答正文；认不出的响应返回空串（空串过不了围栏解析）。 */
export function extractAssistantAnswer(raw: string): string {
  if (raw.trim() === "") return "";

  const payloads = ssePayloads(raw);
  if (payloads.length > 0) {
    const parts: string[] = [];
    for (const payload of payloads) collectText(payload, null, parts);
    const joined = parts.join("");
    if (joined !== "") return joined;
  }

  try {
    const parts: string[] = [];
    collectText(JSON.parse(raw), null, parts);
    return parts.join("");
  } catch {
    // 不是 JSON 也不是流式响应：正文取不到，走下面的兜底。
  }
  return "";
}

const JSON_ESCAPES: Record<string, string> = {
  n: "\n",
  r: "\r",
  t: "\t",
  '"': '"',
  "\\": "\\",
  "/": "/",
};

/** 把响应原文里的转义还原一层，让被 JSON 转义包住的围栏重新变成行。 */
function unescapeOnce(raw: string): string {
  return raw.replace(/\\(n|r|t|"|\\|\/)/g, (match, char: string) => JSON_ESCAPES[char] ?? match);
}

const CLOSING_RESIDUE = /^["}\],\s]/;

/**
 * 兜底块里找收尾的 ```：必须独占一行，且后面要么是行尾，
 * 要么是原文明末拖出来的 JSON 残渣；认不出就不硬切。
 */
function cutFencedBlock(block: string): string {
  let from = ASK_FENCE_OPENING.length;
  for (;;) {
    const index = block.indexOf("```", from);
    if (index === -1) return block;
    const before = block.slice(index - 1, index);
    const after = block.slice(index + 3);
    const ownLine = index === 0 || before === "\n";
    const lineEnd = after === "" || after.startsWith("\n") || CLOSING_RESIDUE.test(after);
    if (ownLine && lineEnd) return block.slice(0, index + 3);
    from = index + 3;
  }
}

/**
 * 响应原文 → 围栏里的问题；没排围栏、排的是普通代码块或非 ask 围栏、
 * 一次排多块（只认第一块）、围栏没闭合，都返回 null。
 */
export function detectAskQuestion(raw: string): string | null {
  const direct = parseAskFence(extractAssistantAnswer(raw));
  if (direct !== null) return direct;

  // 兜底：正文形状认不出时，把原文转义还原一层、从 ```ask 处切进来，
  // 仍然只用 parseAskFence 这一条解析路径。
  const restored = unescapeOnce(raw);
  const start = restored.indexOf(ASK_FENCE_OPENING);
  if (start === -1) return null;
  // 切出围栏块（原文明末会拖着 JSON 残渣）再交给 parseAskFence；切不出就整段交，让围栏解析自己判没闭合。
  return parseAskFence(cutFencedBlock(restored.slice(start)));
}
