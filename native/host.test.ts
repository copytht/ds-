import { describe, expect, it } from "vitest";
// @ts-expect-error -- host 是 .mjs，运行时无声明文件；行为见同名的自检用例。
import { answerOf, createTurnChannel } from "./host.mjs";

describe("answerOf", () => {
  it("只取文本块并拼成一句", () => {
    const end = {
      lastAssistantMessage: [
        { type: "text", text: "前半" },
        { type: "image", url: "x" },
        { type: "text", text: "后半" },
      ],
    };
    expect(answerOf(end)).toBe("前半后半");
  });

  it("没有答复时是空串，不是 undefined", () => {
    expect(answerOf({})).toBe("");
    expect(answerOf(undefined)).toBe("");
  });
});

describe("createTurnChannel", () => {
  const end = (id: string, text: string) => ({
    id,
    lastAssistantMessage: [{ type: "text", text }],
  });

  it("先挂上等、后到终态", async () => {
    const turns = createTurnChannel();
    const waiting = turns.settle("c1");
    turns.deliver(end("c1", "收到了"));
    expect(answerOf(await waiting)).toBe("收到了");
  });

  it("终态先到也不丢：下一个 settle 直接取走", async () => {
    const turns = createTurnChannel();
    turns.deliver(end("c1", "早到的"));
    expect(answerOf(await turns.settle("c1"))).toBe("早到的");
  });

  it("连着两问按先后交付，不串轮", async () => {
    const turns = createTurnChannel();
    const first = turns.settle("c1");
    const second = turns.settle("c1");
    turns.deliver(end("c1", "第一轮"));
    turns.deliver(end("c1", "第二轮"));
    expect(answerOf(await first)).toBe("第一轮");
    expect(answerOf(await second)).toBe("第二轮");
  });

  it("各 child 各算各的", async () => {
    const turns = createTurnChannel();
    const waiting = turns.settle("c1");
    turns.deliver(end("c2", "别人的"));
    turns.deliver(end("c1", "自己的"));
    expect(answerOf(await waiting)).toBe("自己的");
  });
});
