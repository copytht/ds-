/**
 * 围栏解析：从模型输出里认出 ```say 围栏，取出问题正文与标签（页面 → agent 的线协议）。
 *
 * 规则（spec #9）：普通代码块与非 say 围栏一律不认；一次回答最多一块，只认第一块；
 * 正文可多行，用单独一行 ``` 结束。
 *
 * 标签：起始行 ```say#abc <question> 里 #abc 是这一块的身份；回灌首行锚带上同一个，
 * 于是「这块围栏有没有回灌、回的是不是它」一目了然。可省，无标签时 label 为 null。
 */

const OPENING = "```say";
const CLOSING = "```";
const LABEL = /^#([a-z0-9]{1,16})(?=\s|$)/;

/** 一块围栏：问题正文，加上它带的标签（无标签是 null）。 */
export type AskFence = {
  readonly question: string;
  readonly label: string | null;
};

/** 一行是不是围栏起始行：```say 后面只能是行尾、空白或标签（#…）。 */
function isOpeningLine(line: string): boolean {
  if (!line.startsWith(OPENING)) return false;
  const rest = line.slice(OPENING.length);
  return rest === "" || /^[\s#]/.test(rest);
}

/** 把起始行 `#…` 之后那截切开：合法标签进 label，其余当正文开头。 */
function splitLabel(rest: string): { readonly label: string | null; readonly head: string } {
  const match = LABEL.exec(rest);
  if (match === null) return { label: null, head: rest.trim() };
  return { label: match[1] ?? null, head: rest.slice(match[0].length).trim() };
}

/** 找出第一个 say 围栏；找不到、问空了或围栏没闭合都返回 null。 */
export function parseAskFence(text: string): AskFence | null {
  const lines = text.split("\n");
  const start = lines.findIndex(isOpeningLine);
  if (start === -1) return null;

  const { label, head } = splitLabel((lines[start] ?? "").slice(OPENING.length));
  const body: string[] = head === "" ? [] : [head];

  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (line.trim() === CLOSING) {
      const question = body.join("\n").trim();
      return question === "" ? null : { question, label };
    }
    body.push(line);
  }

  // 围栏没闭合：按无效输入处理，不猜后半截。
  return null;
}
