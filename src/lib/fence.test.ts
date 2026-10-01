import { describe, expect, it } from "vitest";

import { fixtureCases, type FenceCase } from "./fixtures";
import { parseAskFence } from "./fence";

describe("parseAskFence · 共享 fixture", () => {
  for (const { name, input, expectedQuestion, expectedLabel } of fixtureCases<FenceCase>(
    "fence.json",
  )) {
    it(name, () => {
      const fence = parseAskFence(input);
      if (expectedQuestion === null) {
        expect(fence).toBeNull();
        return;
      }
      expect(fence?.question).toBe(expectedQuestion);
      expect(fence?.label).toBe(expectedLabel);
    });
  }
});

describe("parseAskFence · 边界", () => {
  it("没有围栏的输入返回 null", () => {
    expect(parseAskFence("")).toBeNull();
    expect(parseAskFence("只是普通文本")).toBeNull();
  });

  it("问题与围栏起始同一行也算有效围栏", () => {
    expect(parseAskFence("```say 合在一行的问题\n```")).toEqual({
      question: "合在一行的问题",
      label: null,
    });
  });

  it("```sayfoo 不是围栏", () => {
    expect(parseAskFence("```sayfoo\n问题\n```")).toBeNull();
  });

  it("``` ask 不是围栏", () => {
    expect(parseAskFence("``` ask\n问题\n```")).toBeNull();
  });

  it("围栏里问空了返回 null", () => {
    expect(parseAskFence("```say   \n```")).toBeNull();
    expect(parseAskFence("```say\n   \n   \n```")).toBeNull();
  });

  it("问题正文只裁掉首尾空白，内部换行保留", () => {
    expect(parseAskFence("```say\n  第一行\n第二行  \n```")).toEqual({
      question: "第一行\n第二行",
      label: null,
    });
  });

  it("只认第一块：后面再排也不追加", () => {
    const text = "```say\n第一个\n```\n```say\n第二个\n```";
    expect(parseAskFence(text)?.question).toBe("第一个");
  });

  it("无标签的老格式仍是 null 标签", () => {
    expect(parseAskFence("```say\n问题\n```")).toEqual({ question: "问题", label: null });
  });

  it("```say#abc 认成标签", () => {
    expect(parseAskFence("```say#abc\n问题\n```")).toEqual({ question: "问题", label: "abc" });
  });

  it("标签与问题同行：标签切掉，剩下的是正文", () => {
    expect(parseAskFence("```say#a3f7 带标签的问题\n```")).toEqual({
      question: "带标签的问题",
      label: "a3f7",
    });
  });

  it("标签后紧跟的不是空白就不是标签：整截当正文", () => {
    expect(parseAskFence("```say#abc问题\n```")?.question).toBe("#abc问题");
    expect(parseAskFence("```say#abc问题\n```")?.label).toBeNull();
  });

  it("大写或超长标签不合规：整截当正文", () => {
    expect(parseAskFence("```say#ABC\n问题\n```")?.label).toBeNull();
    expect(parseAskFence("```say#ABCDEFGHIJKLMNOPQ\n问题\n```")?.label).toBeNull();
  });

  it("标签最大 16 位", () => {
    expect(parseAskFence("```say#abcdefghijklmnop\n问题\n```")?.label).toBe("abcdefghijklmnop");
  });
});
