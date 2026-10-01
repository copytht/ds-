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
    const raw = sse(["先说结论。\n```say ", "仓库里 dsb 的入口在哪？\n第二行补充\n```"]);
    expect(detectAskQuestion(raw)).toEqual({
      question: "仓库里 dsb 的入口在哪？\n第二行补充",
      label: null,
    });
  });

  it("整块 JSON 回答里的围栏同样认得", () => {
    const raw = JSON.stringify({
      choices: [{ message: { content: "```say\n问题正文\n```" } }],
    });
    expect(detectAskQuestion(raw)).toEqual({ question: "问题正文", label: null });
  });

  it("普通代码块不触发", () => {
    const raw = sse(["```ts\nconst a = 1;\n```"]);
    expect(detectAskQuestion(raw)).toBeNull();
  });

  it("非 say 围栏不触发", () => {
    const raw = sse(["```bash\nls -la\n```"]);
    expect(detectAskQuestion(raw)).toBeNull();
  });

  it("`​```sayfoo` 不是围栏起始行", () => {
    const raw = sse(["```sayfoo\n问题\n```"]);
    expect(detectAskQuestion(raw)).toBeNull();
  });

  it("围栏带标签时标签被带出来", () => {
    const raw = sse(["```say#a3f7\n带标签的问题\n```"]);
    expect(detectAskQuestion(raw)).toEqual({ question: "带标签的问题", label: "a3f7" });
  });

  it("一次排多块只认第一块", () => {
    const raw = sse(["```say\n第一块\n```\n中间\n```say\n第二块\n```"]);
    expect(detectAskQuestion(raw)).toEqual({ question: "第一块", label: null });
  });

  it("围栏没闭合按无效输入处理", () => {
    const raw = sse(["```say\n问题还没有收尾"]);
    expect(detectAskQuestion(raw)).toBeNull();
  });

  it("围栏里问空了不触发", () => {
    const raw = sse(["```say\n```"]);
    expect(detectAskQuestion(raw)).toBeNull();
  });

  it("没排围栏的正常回答不触发", () => {
    const raw = sse(["这是不带围栏的回答。"]);
    expect(detectAskQuestion(raw)).toBeNull();
  });

  it("正文形状认不出时，兜底路径仍从转义原文里认出围栏", () => {
    const raw = `data: ${JSON.stringify({ unknown_shape: "看这里\n```say\n兜底问题\n```" })}\n`;
    expect(extractAssistantAnswer(raw)).toBe("");
    expect(detectAskQuestion(raw)).toEqual({ question: "兜底问题", label: null });
  });

  it("认不出的响应整段返回 null，不猜", () => {
    expect(detectAskQuestion("")).toBeNull();
    expect(detectAskQuestion("<html>502</html>")).toBeNull();
  });

  it("兜底路径也认没闭合的围栏不算数", () => {
    const raw = `data: ${JSON.stringify({
      unknown_shape: "看这里\n```say\n问题没收尾\n```js\nconst a = 1;",
    })}\n`;
    expect(detectAskQuestion(raw)).toBeNull();
  });
});

describe("detectAskQuestion · 站点那条 OT 增量流", () => {
  /**
   * 真机抓的形状（2026-09-29，chat.deepseek.com/api/v0/chat/completion）：
   * 正文不在 `content` 键里，而是散在追加操作中；围栏被切成两个载荷下发
   * （`{"v":"```"}` 紧跟 `{"v":"say"}`）；思考片里还举了一个 ```say 的例子。
   */
  const REAL_OT_STREAM = [
    "event: ready",
    'data: {"request_message_id":9,"response_message_id":10,"model_type":"default"}',
    "",
    "event: update_session",
    'data: {"updated_at":1790663229.828996}',
    "",
    'data: {"v":{"response":{"message_id":10,"parent_id":9,"role":"ASSISTANT","thinking_enabled":true,"status":"WIP","fragments":[{"id":2,"type":"THINK","content":"我们需要"}]}}}',
    "",
    'data: {"p":"response/fragments/-1/content","o":"APPEND","v":"先想清楚。协议要排围栏，例子是："}',
    'data: {"v":"\\n\\n```say\\n模型自己举的例子\\n```"}',
    'data: {"p":"response/fragments/-1/elapsed_secs","o":"SET","v":1.214978037}',
    "",
    'data: {"p":"response/fragments","o":"APPEND","v":[{"id":3,"type":"RESPONSE","content":"```","references":[],"stage_id":1}]}',
    'data: {"p":"response/fragments/-1/content","v":"say"}',
    'data: {"v":"\\n"}',
    'data: {"v":"CONTEXT.md 这个文件是干什么的？\\n"}',
    'data: {"v":"```"}',
    'data: {"p":"response","o":"BATCH","v":[{"p":"accumulated_token_usage","v":1075},{"p":"quasi_status","v":"FINISHED"}]}',
    'data: {"p":"response/status","o":"SET","v":"FINISHED"}',
    "",
    "event: close",
    'data: {"click_behavior":"none","auto_resume":false}',
    "",
  ].join("\n");

  it("正文只在 RESPONSE 片段里，思考片不计入", () => {
    expect(extractAssistantAnswer(REAL_OT_STREAM)).toBe(
      "```say\nCONTEXT.md 这个文件是干什么的？\n```",
    );
  });

  it("围栏被切成两个载荷也认得出问题", () => {
    expect(detectAskQuestion(REAL_OT_STREAM)).toEqual({
      question: "CONTEXT.md 这个文件是干什么的？",
      label: null,
    });
  });

  it("思考片里举的围栏例子不算回答", () => {
    // 把正文片换成一句没有围栏的话：思考片里的 ```say 不能被捞出来当真。
    const noFence = REAL_OT_STREAM.replace(
      'data: {"p":"response/fragments","o":"APPEND","v":[{"id":3,"type":"RESPONSE","content":"```","references":[],"stage_id":1}]}',
      'data: {"p":"response/fragments","o":"APPEND","v":[{"id":3,"type":"RESPONSE","content":"好的。","references":[],"stage_id":1}]}',
    )
      .replace('data: {"p":"response/fragments/-1/content","v":"say"}\n', "")
      .replace('data: {"v":"\\n"}\n', "")
      .replace('data: {"v":"CONTEXT.md 这个文件是干什么的？\\n"}\n', "")
      .replace('data: {"v":"```"}\n', "");
    expect(extractAssistantAnswer(noFence)).toBe("好的。");
    expect(detectAskQuestion(noFence)).toBeNull();
  });

  it("状态、计时、token 这些非正文操作不产生正文", () => {
    const onlyOps = [
      'data: {"v":{"response":{"fragments":[]}}}',
      'data: {"p":"response/fragments/-1/elapsed_secs","o":"SET","v":1.2}',
      'data: {"p":"response/status","o":"SET","v":"FINISHED"}',
      'data: {"p":"response","o":"BATCH","v":[{"p":"accumulated_token_usage","v":10}]}',
      "",
    ].join("\n");
    expect(extractAssistantAnswer(onlyOps)).toBe("");
    expect(detectAskQuestion(onlyOps)).toBeNull();
  });
});
