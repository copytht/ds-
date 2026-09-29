import { describe, expect, it } from "vitest";

import { prependInstructions, PROTOCOL_INSTRUCTIONS } from "./instructions";

// spec #9 正文里的文案，逐字抄一份当黄金值：改写一个字这里就红。
const SPEC_WORDING = `【ds 协议】需要写代码、查本机或需要第二双眼时，可以把问题交给本机的编码 agent。
把问题排成一个围栏块，然后停止回答、等待回灌：

\`\`\`ask <question>
\`\`\`

- <question> 换成问题正文，可以多行，用单独一行 \`\`\` 结束。
- 一次回答最多排一块；排完就停，不要替它往下写。
- 它的回答以 \`agent:\` 开头、TOON 格式，status: ok 时 answer 是正文。
- 若没有收到 \`agent:\` 回灌，说明这次没问成：不要追问、不要重排，当作没问过，继续别的内容。
- 用不到 agent 时忽略本说明。`;

describe("PROTOCOL_INSTRUCTIONS", () => {
  it("与 spec #9 的文案逐字一致", () => {
    expect(PROTOCOL_INSTRUCTIONS).toBe(SPEC_WORDING);
  });

  it("以围栏用法开头，收在忽略说明上", () => {
    expect(PROTOCOL_INSTRUCTIONS.startsWith("【ds 协议】")).toBe(true);
    expect(PROTOCOL_INSTRUCTIONS.endsWith("用不到 agent 时忽略本说明。")).toBe(true);
    expect(PROTOCOL_INSTRUCTIONS).toContain("```ask <question>");
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
