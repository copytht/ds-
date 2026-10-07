import { describe, expect, it } from "vitest";

import {
  checkSend,
  checkSendIntent,
  mergeSendPace,
  newSendPace,
  noteSend,
  sendWaitMs,
  SEND_PRIMITIVES,
  type SendPace,
} from "./sendpace";
import { WINDOW_MAX_MS, WINDOW_MIN_MS } from "./outbound";

const random0 = () => 0;
const random1 = () => 1;

describe("发送限速的间隔与出站窗口同区间（#61）", () => {
  it("抽出来的间隔落在 3~5 秒（沿用 outbound 的两个常量）", () => {
    const low = noteSend(newSendPace(), 0, random0);
    const high = noteSend(newSendPace(), 0, random1);
    expect(low.intervalMs).toBe(WINDOW_MIN_MS);
    expect(high.intervalMs).toBe(WINDOW_MAX_MS);
  });
});

describe("sendWaitMs · 还要等多久", () => {
  it("没发过：不等", () => {
    expect(sendWaitMs(newSendPace(), 999_999)).toBe(0);
  });

  it("刚发完：要等满整个间隔", () => {
    const pace = noteSend(newSendPace(), 1000, random0);
    expect(sendWaitMs(pace, 1000)).toBe(WINDOW_MIN_MS);
  });

  it("隔了一半：等剩下那一半", () => {
    const pace = noteSend(newSendPace(), 1000, random0);
    expect(sendWaitMs(pace, 1000 + 1000)).toBe(WINDOW_MIN_MS - 1000);
  });

  it("隔够了：不等", () => {
    const pace = noteSend(newSendPace(), 1000, random0);
    expect(sendWaitMs(pace, 1000 + WINDOW_MIN_MS)).toBe(0);
    expect(sendWaitMs(pace, 1000 + WINDOW_MIN_MS + 1)).toBe(0);
  });

  it("时钟回拨（now < lastSentAt）不当负数：宁可少限一次", () => {
    const pace: SendPace = { lastSentAt: 10_000, intervalMs: 3000 };
    expect(sendWaitMs(pace, 5000)).toBe(0);
  });
});

describe("checkSend · 发送原语检查点", () => {
  it("确定是发送：参与限速，给出要等多久", () => {
    const pace = noteSend(newSendPace(), 1000, random0);
    const verdict = checkSend(pace, 1000, true);
    expect(verdict.paced).toBe(true);
    expect(verdict.waitMs).toBe(WINDOW_MIN_MS);
  });

  it("判不出是不是发送（可能是「停止」）：不参与限速，一律放行", () => {
    const pace = noteSend(newSendPace(), 1000, random0);
    const verdict = checkSend(pace, 1000, false);
    expect(verdict.paced).toBe(false);
    expect(verdict.waitMs).toBe(0);
  });

  it("没有待发的：paced 仍为 true 但不等（口径一致，由记账与否决定）", () => {
    const verdict = checkSend(newSendPace(), 0, true);
    expect(verdict.paced).toBe(true);
    expect(verdict.waitMs).toBe(0);
  });
});

describe("checkSendIntent · 三种意图各自的口径", () => {
  const pace = noteSend(newSendPace(), 1000, random0);

  it("send：等够 + 记账", () => {
    expect(checkSendIntent(pace, 1000, "send")).toEqual({
      waitMs: WINDOW_MIN_MS,
      paced: true,
      record: true,
    });
  });

  it("stop：不等 + 不记（「停止」永不延迟）", () => {
    expect(checkSendIntent(pace, 1000, "stop")).toEqual({
      waitMs: 0,
      paced: false,
      record: false,
    });
  });

  it("unknown：不等但记账（宁可之后多等一次，也不漏记一次发送）", () => {
    expect(checkSendIntent(pace, 1000, "unknown")).toEqual({
      waitMs: 0,
      paced: false,
      record: true,
    });
  });

  it("checkSend 是 checkSendIntent 的两口味薄封装", () => {
    expect(checkSend(pace, 1000, true)).toEqual(checkSendIntent(pace, 1000, "send"));
    expect(checkSend(pace, 1000, false)).toEqual(checkSendIntent(pace, 1000, "unknown"));
  });
});

describe("mergeSendPace · 跨世界并时刻", () => {
  it("对方报来更晚的时刻：取它的", () => {
    const mine = noteSend(newSendPace(), 1000, random0);
    const merged = mergeSendPace(mine, 5000);
    expect(merged.lastSentAt).toBe(5000);
  });

  it("我自己的更晚：不覆盖（否则紧接着那一下会少等）", () => {
    const mine = noteSend(newSendPace(), 5000, random0);
    expect(mergeSendPace(mine, 1000)).toBe(mine);
  });

  it("对方没发过（null）：原样", () => {
    const mine = newSendPace();
    expect(mergeSendPace(mine, null)).toBe(mine);
  });

  it("对方的通报不覆盖我抽的间隔（各抽各的）", () => {
    const mine = noteSend(newSendPace(), 1000, random1);
    const merged = mergeSendPace(mine, 2000);
    expect(merged.intervalMs).toBe(mine.intervalMs);
  });
});

describe("SEND_PRIMITIVES · 限速名单", () => {
  it("三种发送原语都在", () => {
    expect(SEND_PRIMITIVES.has("send.enter")).toBe(true);
    expect(SEND_PRIMITIVES.has("button.click")).toBe(true);
    expect(SEND_PRIMITIVES.has("message.retry")).toBe(true);
  });

  it("只往输入框写字的、以及「停止」都不在名单里", () => {
    expect(SEND_PRIMITIVES.has("composer.type")).toBe(false);
    expect(SEND_PRIMITIVES.has("composer.clear")).toBe(false);
  });
});
