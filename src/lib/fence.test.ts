import { describe, expect, it } from "vitest";

import { fixtureCases, type FenceCase } from "./fixtures";
import { parseAskFence, parseSendFence } from "./fence";

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

describe("parseAskFence · 边界（#26）", () => {
  it("有效 ask 围栏", () => {
    expect(parseAskFence("```ask\n选 A 还是 B？\n```")).toBe("选 A 还是 B？");
  });

  it("问题与围栏起始同一行也算有效围栏", () => {
    expect(parseAskFence("```ask 合在一行的问题\n```")).toBe("合在一行的问题");
  });

  it("```askfoo 不是围栏", () => {
    expect(parseAskFence("```askfoo\n问题\n```")).toBeNull();
  });

  it("两种围栏各认各的：send 不被 ask 认、ask 不被 send 认", () => {
    expect(parseAskFence("```send\n问题\n```")).toBeNull();
    expect(parseSendFence("```ask\n问题\n```")).toBeNull();
  });

  it("围栏没闭合返回 null", () => {
    expect(parseAskFence("```ask\n问题还没写完")).toBeNull();
  });

  it("围栏里问空了返回 null", () => {
    expect(parseAskFence("```ask   \n```")).toBeNull();
    expect(parseAskFence("```ask\n   \n   \n```")).toBeNull();
  });

  it("普通代码块不是围栏", () => {
    expect(parseAskFence("```py\nprint('hi')\n```")).toBeNull();
  });

  it("只认第一块：后面再排也不追加", () => {
    const text = "```ask\n第一个\n```\n```ask\n第二个\n```";
    expect(parseAskFence(text)).toBe("第一个");
  });
});
