import { describe, expect, it } from "vitest";

import { detectAskQuestion, extractAssistantAnswer } from "./answer";

/** 拼一个流式响应：每块一行 `data:` 载荷，形状对齐站点的发消息接口。 */
function sse(chunks: string[]): string {
  const lines = chunks.map(
    (content) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}`,
  );
  return `${lines.join("\n")}\n\ndata: [DONE]\n`;
}

describe("extractAssistantAnswer", () => {
  it("流式响应按块还原成一段正文", () => {
    const raw = sse(["你好，", "这是回答。"]);
    expect(extractAssistantAnswer(raw)).toBe("你好，这是回答。");
  });

  it("整块 JSON 响应取 message.content", () => {
    const raw = JSON.stringify({ choices: [{ message: { content: "整段回答" } }] });
    expect(extractAssistantAnswer(raw)).toBe("整段回答");
  });

  it("reasoning 之类的过程文本不当成回答", () => {
    const raw = JSON.stringify({
      choices: [{ message: { reasoning_content: "先想一想", content: "正文" } }],
    });
    expect(extractAssistantAnswer(raw)).toBe("正文");
  });

  it("认不出的响应返回空串", () => {
    expect(extractAssistantAnswer("")).toBe("");
    expect(extractAssistantAnswer("not json at all")).toBe("");
    expect(extractAssistantAnswer(JSON.stringify({ hello: "world" }))).toBe("");
  });
});

describe("detectAskQuestion · 检测点", () => {
  it("流式回答里排了围栏就认出问题（多行问题也认）", () => {
    const raw = sse(["先说结论。\n```ask ", "仓库里 dsb 的入口在哪？\n第二行补充\n```"]);
    expect(detectAskQuestion(raw)).toBe("仓库里 dsb 的入口在哪？\n第二行补充");
  });

  it("整块 JSON 回答里的围栏同样认得", () => {
    const raw = JSON.stringify({
      choices: [{ message: { content: "```ask\n问题正文\n```" } }],
    });
    expect(detectAskQuestion(raw)).toBe("问题正文");
  });

  it("普通代码块不触发", () => {
    const raw = sse(["```ts\nconst a = 1;\n```"]);
    expect(detectAskQuestion(raw)).toBeNull();
  });

  it("非 ask 围栏不触发", () => {
    const raw = sse(["```bash\nls -la\n```"]);
    expect(detectAskQuestion(raw)).toBeNull();
  });

  it("`​```askfoo` 不是围栏起始行", () => {
    const raw = sse(["```askfoo\n问题\n```"]);
    expect(detectAskQuestion(raw)).toBeNull();
  });

  it("一次排多块只认第一块", () => {
    const raw = sse(["```ask\n第一块\n```\n中间\n```ask\n第二块\n```"]);
    expect(detectAskQuestion(raw)).toBe("第一块");
  });

  it("围栏没闭合按无效输入处理", () => {
    const raw = sse(["```ask\n问题还没有收尾"]);
    expect(detectAskQuestion(raw)).toBeNull();
  });

  it("围栏里问空了不触发", () => {
    const raw = sse(["```ask\n```"]);
    expect(detectAskQuestion(raw)).toBeNull();
  });

  it("没排围栏的正常回答不触发", () => {
    const raw = sse(["这是不带围栏的回答。"]);
    expect(detectAskQuestion(raw)).toBeNull();
  });

  it("正文形状认不出时，兜底路径仍从转义原文里认出围栏", () => {
    const raw = `data: ${JSON.stringify({ unknown_shape: "看这里\n```ask\n兜底问题\n```" })}\n`;
    expect(extractAssistantAnswer(raw)).toBe("");
    expect(detectAskQuestion(raw)).toBe("兜底问题");
  });

  it("认不出的响应整段返回 null，不猜", () => {
    expect(detectAskQuestion("")).toBeNull();
    expect(detectAskQuestion("<html>502</html>")).toBeNull();
  });

  it("兜底路径也认没闭合的围栏不算数", () => {
    const raw = `data: ${JSON.stringify({
      unknown_shape: "看这里\n```ask\n问题没收尾\n```js\nconst a = 1;",
    })}\n`;
    expect(detectAskQuestion(raw)).toBeNull();
  });
});
