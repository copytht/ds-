import { describe, expect, it } from "vitest";

import { prependInstructions, PROTOCOL_INSTRUCTIONS } from "./instructions";

// spec #9 正文里的文案，逐字抄一份当黄金值：改写一个字这里就红。
const SPEC_WORDING = `【ds 协议】需要写代码、查本机或需要第二双眼时，可以把问题交给本机的编码 agent。
把问题排成一个围栏块，然后停止回答、等待回灌：

\`\`\`say#<label> <question>
\`\`\`

- <label> 是这块围栏的短标签（小写字母数字，1–16 位，同一会话内唯一，例如 a3f7），<question> 换成问题正文；可以多行，用单独一行 \`\`\` 结束。标签可省（写成 \`\`\`say <question>），但带上它，回灌才能对上是哪一块。
- 一次回答最多排一块；排完就停，不要替它往下写。
- 它的回答首行是 \`agent:#<label>\`（你排的标签；没带标签就还是 \`agent:\`），第二行是 \`status: ok\`（没问成则是 \`status: error\` 加 \`error: <code>\`）。
- \`status: ok\` 时跟着 \`answer[N]{text}:\`，底下每行一条（缩进两格）：第 1 条就是正文第 1 行，依次连起来即完整正文；行首行尾的双引号是包裹，去掉即可，行内偶见的反斜杠只用来包住双引号和反斜杠自己、还原成原字符。换行原样保留，不会被转义。
- 若没有收到 \`agent:\` 回灌，说明这次没问成：不要追问、不要重排，当作没问过，继续别的内容。
- 用不到 agent 时忽略本说明。`;

describe("PROTOCOL_INSTRUCTIONS", () => {
  it("与 spec #9 的文案逐字一致", () => {
    expect(PROTOCOL_INSTRUCTIONS).toBe(SPEC_WORDING);
  });

  it("以围栏用法开头，收在忽略说明上", () => {
    expect(PROTOCOL_INSTRUCTIONS.startsWith("【ds 协议】")).toBe(true);
    expect(PROTOCOL_INSTRUCTIONS.endsWith("用不到 agent 时忽略本说明。")).toBe(true);
    expect(PROTOCOL_INSTRUCTIONS).toContain("```say <question>");
  });
});

describe("prependInstructions", () => {
  it("把协议说明拼在消息开头", () => {
    const message = prependInstructions("帮我看看这个报错");
    expect(message.startsWith(`${SPEC_WORDING}\n\n`)).toBe(true);
    expect(message.endsWith("帮我看看这个报错")).toBe(true);
  });

  it("原文一个字不丢", () => {
    expect(prependInstructions("原文")).toContain("\n\n原文");
    expect(prependInstructions("原文").slice(SPEC_WORDING.length)).toBe("\n\n原文");
  });
});
