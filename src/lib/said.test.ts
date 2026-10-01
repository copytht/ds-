import { describe, expect, it } from "vitest";

import { reportSaid, SAID_URL } from "./said";

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
