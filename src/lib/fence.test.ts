import { describe, expect, it } from "vitest";

import { fixtureCases, type FenceCase } from "./fixtures";
import { parseAskFence } from "./fence";

describe("parseAskFence · 共享 fixture", () => {
  for (const { name, input, expectedQuestion } of fixtureCases<FenceCase>("fence.json")) {
    it(name, () => {
      expect(parseAskFence(input)).toBe(expectedQuestion);
    });
  }
});

describe("parseAskFence · 边界", () => {
  it("没有围栏的输入返回 null", () => {
    expect(parseAskFence("")).toBeNull();
    expect(parseAskFence("只是普通文本")).toBeNull();
  });

  it("问题与围栏起始同一行也算有效围栏", () => {
    expect(parseAskFence("```ask 合在一行的问题\n```")).toBe("合在一行的问题");
  });

  it("```askfoo 不是围栏", () => {
    expect(parseAskFence("```askfoo\n问题\n```")).toBeNull();
  });

  it("``` ask 不是围栏", () => {
    expect(parseAskFence("``` ask\n问题\n```")).toBeNull();
  });

  it("围栏里问空了返回 null", () => {
    expect(parseAskFence("```ask   \n```")).toBeNull();
    expect(parseAskFence("```ask\n   \n   \n```")).toBeNull();
  });

  it("问题正文只裁掉首尾空白，内部换行保留", () => {
    expect(parseAskFence("```ask\n  第一行\n第二行  \n```")).toBe("第一行\n第二行");
  });

  it("只认第一块：后面再排也不追加", () => {
    const text = "```ask\n第一个\n```\n```ask\n第二个\n```";
    expect(parseAskFence(text)).toBe("第一个");
  });
});
