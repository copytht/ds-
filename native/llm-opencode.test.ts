import { describe, expect, it } from "vitest";
// @ts-expect-error -- 适配器是 .mjs，运行时无声明文件；行为见同名的自检用例。
import { renderPrompt } from "./llm-opencode.mjs";

const text = (value: string) => [{ type: "text", text: value }];

describe("renderPrompt", () => {
  it("把 system 提示放在最前，且同一条只出现一次", () => {
    const prompt = renderPrompt({
      system: "只答问题本身。",
      messages: [
        { role: "system", content: text("只答问题本身。") },
        { role: "user", content: text("跑一下测试") },
      ],
    });
    expect(prompt).toBe("只答问题本身。\n\nuser:\n跑一下测试");
  });

  it("跳过非文本块与空消息", () => {
    const prompt = renderPrompt({
      messages: [
        { role: "user", content: [{ type: "image" }, { type: "text", text: "看图" }] },
        { role: "assistant", content: text("") },
      ],
    });
    expect(prompt).toBe("user:\n看图");
  });

  it("接受裸字符串正文", () => {
    expect(renderPrompt({ messages: [{ role: "user", content: "你好" }] })).toBe("user:\n你好");
  });
});
