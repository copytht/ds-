/**
 * 围栏解析：从模型输出里认出 ```send 围栏，取出问题正文（页面 → agent 的线协议）。
 *
 * 规则（spec #9）：普通代码块与非 send 围栏一律不认；一次回答最多一块，只认第一块；
 * 正文可多行，用单独一行 ``` 结束。
 */

const OPENING = "```send";
const CLOSING = "```";

/** 一行是不是围栏起始行：```send 后面只能是行尾或空白，```sendfoo 不算。 */
function isOpeningLine(line: string): boolean {
  if (!line.startsWith(OPENING)) return false;
  const rest = line.slice(OPENING.length);
  return rest === "" || /^\s/.test(rest);
}

/** 找出第一个 send 围栏的问题正文；找不到、问空了或围栏没闭合都返回 null。 */
export function parseSendFence(text: string): string | null {
  const lines = text.split("\n");
  const start = lines.findIndex(isOpeningLine);
  if (start === -1) return null;

  const rest = (lines[start] ?? "").slice(OPENING.length).trim();
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
