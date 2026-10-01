import { describe, expect, it } from "vitest";

import { fixtureCases, type FenceCase } from "./fixtures";
import { parseSendFence } from "./fence";

describe("parseSendFence · 共享 fixture", () => {
  for (const { name, input, expectedQuestion } of fixtureCases<FenceCase>("fence.json")) {
    it(name, () => {
      expect(parseSendFence(input)).toBe(expectedQuestion);
    });
  }
});

describe("parseSendFence · 边界", () => {
  it("没有围栏的输入返回 null", () => {
    expect(parseSendFence("")).toBeNull();
    expect(parseSendFence("只是普通文本")).toBeNull();
  });

  it("问题与围栏起始同一行也算有效围栏", () => {
    expect(parseSendFence("```send 合在一行的问题\n```")).toBe("合在一行的问题");
  });

  it("```sendfoo 不是围栏", () => {
    expect(parseSendFence("```sendfoo\n问题\n```")).toBeNull();
  });

  it("``` send（空格版）不是围栏", () => {
    expect(parseSendFence("``` send\n问题\n```")).toBeNull();
  });

  it("```say 是旧词，不再被认出", () => {
    expect(parseSendFence("```say\n问题\n```")).toBeNull();
  });

  it("围栏里问空了返回 null", () => {
    expect(parseSendFence("```send   \n```")).toBeNull();
    expect(parseSendFence("```send\n   \n   \n```")).toBeNull();
  });

  it("问题正文只裁掉首尾空白，内部换行保留", () => {
    expect(parseSendFence("```send\n  第一行\n第二行  \n```")).toBe("第一行\n第二行");
  });

  it("只认第一块：后面再排也不追加", () => {
    const text = "```send\n第一个\n```\n```send\n第二个\n```";
    expect(parseSendFence(text)).toBe("第一个");
  });
});
