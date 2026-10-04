/**
 * 围栏解析：从模型输出里认出协议围栏，取出围栏正文。
 * 页面 → 扩展的线协议是 ```send（一段工具调用 JSON）；页面向人举手是
 * ```ask（#26）——认出但不转给中继，见 `inject.content.ts`。
 *
 * 规则：普通代码块与非协议围栏一律不认；一次回答最多一块，只认
 * 第一块；正文可多行，用单独一行 ``` 结束。
 */

const SEND_OPENING = "```send";
const ASK_OPENING = "```ask";
const CLOSING = "```";

/** 一行是不是某种围栏的起始行：```<opening> 后面只能是行尾或空白，```sendfoo 不算。 */
function isOpeningLine(line: string, opening: string): boolean {
  if (!line.startsWith(opening)) return false;
  const rest = line.slice(opening.length);
  return rest === "" || /^\s/.test(rest);
}

/** 找出第一个指定围栏的正文；找不到、问空了或围栏没闭合都返回 null。 */
function parseFence(text: string, opening: string): string | null {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => isOpeningLine(line, opening));
  if (start === -1) return null;

  const rest = (lines[start] ?? "").slice(opening.length).trim();
  const body: string[] = rest === "" ? [] : [rest];

  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (line.trim() === CLOSING) {
      const question = body.join("\n").trim();
      return question === "" ? null : question;
    }
    body.push(line);
  }

  // 围栏没闭合：按无效输入处理，不猜后半截。
  return null;
}

/** 找出第一个 send 围栏的问题正文（转给中继的那条）。 */
export function parseSendFence(text: string): string | null {
  return parseFence(text, SEND_OPENING);
}

/** 找出第一个 ask 围栏的问题正文（网页向人举手，不转给中继）。 */
export function parseAskFence(text: string): string | null {
  return parseFence(text, ASK_OPENING);
}

/* -------------------------------------------------------------------------- */
/* 围栏里的工具调用                                                           */
/* -------------------------------------------------------------------------- */

/** 模型在 ```send 围栏里排的东西：只有 `tool` 与 `arguments` 两个键。 */
export type ToolCall = {
  readonly tool: string;
  readonly arguments: Record<string, unknown>;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 围栏正文 → 工具调用；排得不成形一律 null，不猜。
 *
 * 猜的代价不对称：猜错了会替模型选一个它没想选的工具，所以宁可把
 * `MALFORMED_CALL_HINT` 回灌进去让它自己改，也不在这里修形状。
 *
 * 住这里（而不是 relay）：**读 DOM** 的那半边也要认工具调用——新版站点把 ```send
 * 渲染成代码块（``` 标记没了），`messages.ts` 读行文本时得靠它判「这是不是一段
 * 工具调用」，好把围栏还原回去。relay 转出去，中继那条线的调用方照旧。
 */
export function parseToolCall(text: string): ToolCall | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isPlainObject(parsed)) return null;
  const tool = parsed["tool"];
  if (typeof tool !== "string" || tool.trim() === "") return null;
  const args = parsed["arguments"] ?? {};
  if (!isPlainObject(args)) return null;
  return { tool, arguments: args };
}

/** 围栏排坏了时回灌的正文（`status: ok` 的一条，进对话流，让模型自己改）。 */
export const MALFORMED_CALL_HINT =
  '围栏里不是合法的工具调用。期望形状：{"tool": "工具名", "arguments": {…按该工具的入参…}}，' +
  "arguments 是对象（没有参数写 {}）；一次最多排一块。";
