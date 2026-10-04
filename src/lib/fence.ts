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
