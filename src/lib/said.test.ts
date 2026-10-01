import { describe, expect, it } from "vitest";

import { outsideFences, reportSaid, SAID_URL } from "./said";

describe("reportSaid", () => {
  it("把正文原样 POST 到收话端点", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init.body)) });
      return new Response("{}");
    }) as unknown as typeof fetch;

    await reportSaid("网页说给人听的一句话", fake);

    expect(calls).toEqual([{ url: SAID_URL, body: { text: "网页说给人听的一句话" } }]);
  });

  it("报不上也不抛（这条只是让人看见，不是回路）", async () => {
    const boom = (async () => {
      throw new Error("连不上");
    }) as unknown as typeof fetch;

    await expect(reportSaid("x", boom)).resolves.toBeUndefined();
  });
});

describe("outsideFences", () => {
  it("摘掉围栏，留下围栏外的话", () => {
    const text = "先说一句给人听的。\n\n```say\n帮我跑个东西\n```\n\n排完了，等它。";
    expect(outsideFences(text)).toBe("先说一句给人听的。\n\n\n\n排完了，等它。");
  });

  it("没有围栏就原样", () => {
    expect(outsideFences("只有一句普通回答。")).toBe("只有一句普通回答。");
  });

  it("全是围栏就空", () => {
    expect(outsideFences("```say\n帮我跑个东西\n```")).toBe("");
  });
});
