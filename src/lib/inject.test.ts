import { describe, expect, it } from "vitest";

import { isOutgoingChatRequest, rewriteOutgoingBody } from "./inject";
import { prependInstructions, PROTOCOL_INSTRUCTIONS } from "./instructions";
import { buildReply, okPayload, REPLY_ANCHOR } from "./reply";

describe("isOutgoingChatRequest", () => {
  it("认得站点原生的发消息出口", () => {
    expect(isOutgoingChatRequest("POST", "https://chat.deepseek.com/api/v0/chat/completion")).toBe(
      true,
    );
    expect(isOutgoingChatRequest("post", "/api/v0/chat/completion")).toBe(true);
    expect(isOutgoingChatRequest("POST", "https://chat.deepseek.com/api/v0/chat/regenerate")).toBe(
      true,
    );
    expect(isOutgoingChatRequest("POST", "https://api.deepseek.com/v1/chat/completions")).toBe(
      true,
    );
  });

  it("方法不对不碰", () => {
    expect(isOutgoingChatRequest("GET", "/api/v0/chat/completion")).toBe(false);
    expect(isOutgoingChatRequest("PUT", "/api/v0/chat/completion")).toBe(false);
  });

  it("同域名的别的接口不碰", () => {
    expect(isOutgoingChatRequest("POST", "/api/v0/chat/create_session")).toBe(false);
    expect(isOutgoingChatRequest("POST", "/api/v0/chat_session/fetch_page")).toBe(false);
    expect(isOutgoingChatRequest("POST", "/api/v0/chat/history_messages?x=1")).toBe(false);
    expect(isOutgoingChatRequest("POST", "https://chat.deepseek.com/api/v0/users/current")).toBe(
      false,
    );
  });

  it("第三方域名上碰巧同名的路径不碰", () => {
    expect(isOutgoingChatRequest("POST", "https://evil.example/v1/chat/completions")).toBe(false);
    expect(
      isOutgoingChatRequest("POST", "https://deepseek.com.evil.example/api/v0/chat/completion"),
    ).toBe(false);
  });
});

describe("rewriteOutgoingBody", () => {
  it("把协议说明拼在 prompt 开头，原文一个字不丢", () => {
    const prompt = "帮我看看这个报错";
    const rewritten = rewriteOutgoingBody(JSON.stringify({ prompt, chat_session_id: "s1" }));

    expect(rewritten).not.toBeNull();
    const payload = JSON.parse(rewritten ?? "") as Record<string, unknown>;
    expect(payload.prompt).toBe(prependInstructions(prompt));
    expect(payload.chat_session_id).toBe("s1");
    expect(String(payload.prompt).startsWith(`${PROTOCOL_INSTRUCTIONS}\n\n`)).toBe(true);
  });

  it("多行消息整段原样跟在协议说明后面", () => {
    const prompt = "第一行\n第二行\n\n第四行（空行后面）";
    const rewritten = rewriteOutgoingBody(JSON.stringify({ prompt }));
    const payload = JSON.parse(rewritten ?? "") as Record<string, unknown>;

    expect(payload.prompt).toBe(`${PROTOCOL_INSTRUCTIONS}\n\n${prompt}`);
    expect(String(payload.prompt).endsWith(prompt)).toBe(true);
  });

  it("空消息没东西可发，原样放行", () => {
    expect(rewriteOutgoingBody(JSON.stringify({ prompt: "" }))).toBeNull();
    expect(rewriteOutgoingBody(JSON.stringify({ prompt: "   \n  " }))).toBeNull();
    expect(rewriteOutgoingBody("")).toBeNull();
  });

  it("拼过一遍的不再拼第二遍", () => {
    const once = rewriteOutgoingBody(JSON.stringify({ prompt: "原文" }));

    expect(once).not.toBeNull();
    expect(rewriteOutgoingBody(once ?? "")).toBeNull();
  });

  it("messages 形状：只动 role: user，历史里的角色照旧", () => {
    const body = JSON.stringify({
      messages: [
        { role: "system", content: "你是个助手" },
        { role: "user", content: "上一轮" },
        { role: "assistant", content: "上一轮答复" },
        { role: "user", content: "这一轮" },
      ],
    });

    const rewritten = rewriteOutgoingBody(body);
    expect(rewritten).not.toBeNull();

    const payload = JSON.parse(rewritten ?? "") as {
      messages: { role: string; content: string }[];
    };
    expect(payload.messages[0]?.content).toBe("你是个助手");
    expect(payload.messages[1]?.content).toBe(prependInstructions("上一轮"));
    expect(payload.messages[2]?.content).toBe("上一轮答复");
    expect(payload.messages[3]?.content).toBe(prependInstructions("这一轮"));
  });

  it("整段历史再发一遍时，拼过的用户消息不会被拼第二次", () => {
    const first = rewriteOutgoingBody(
      JSON.stringify({ messages: [{ role: "user", content: "原文" }] }),
    );
    const second = rewriteOutgoingBody(first ?? "");

    expect(second).toBeNull();
  });

  it("认不出的载荷原样放行", () => {
    expect(rewriteOutgoingBody("不是 JSON")).toBeNull();
    expect(rewriteOutgoingBody("[1,2,3]")).toBeNull();
    expect(rewriteOutgoingBody('"prompt"')).toBeNull();
    expect(rewriteOutgoingBody(JSON.stringify({ messages: "不是数组" }))).toBeNull();
    expect(rewriteOutgoingBody(JSON.stringify({ text: "别的字段" }))).toBeNull();
    expect(
      rewriteOutgoingBody(JSON.stringify({ messages: [{ role: "tool", content: "回执" }] })),
    ).toBeNull();
    expect(
      rewriteOutgoingBody(JSON.stringify({ messages: [{ role: "user", content: 42 }] })),
    ).toBeNull();
  });

  it("回灌消息（首行锚 agent:）不拼协议说明，首行锚留在第一行", () => {
    const reply = buildReply(okPayload("答复正文"));

    expect(reply.split("\n")[0]).toBe(REPLY_ANCHOR);
    expect(rewriteOutgoingBody(JSON.stringify({ prompt: reply }))).toBeNull();
    expect(
      rewriteOutgoingBody(JSON.stringify({ messages: [{ role: "user", content: reply }] })),
    ).toBeNull();
  });

  it("只是以 agent 开头的普通消息照样拼说明", () => {
    const rewritten = rewriteOutgoingBody(JSON.stringify({ prompt: "agent 你好，帮我看看" }));
    expect(rewritten).not.toBeNull();
    expect(JSON.parse(rewritten ?? "")["prompt"]).toBe(prependInstructions("agent 你好，帮我看看"));
  });
});
