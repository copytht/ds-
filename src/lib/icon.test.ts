import { describe, expect, it } from "vitest";

import {
  ICON_COLORS,
  ICON_SIZE,
  ICON_STATES,
  SPIN_FRAMES,
  afterHealthProbe,
  badgeText,
  describeAccount,
  describeSend,
  iconTitle,
  renderIcon,
  spinFrame,
} from "./icon";
import { SEND_PHASES, type SendStatus } from "./relay";
import { failureNotice, RELAY_START_COMMAND } from "./reply";
import type { AccountState } from "./page";

function pixelAt(pixels: Uint8ClampedArray, x: number, y: number, size = ICON_SIZE) {
  const offset = (y * size + x) * 4;
  return [pixels[offset], pixels[offset + 1], pixels[offset + 2], pixels[offset + 3]];
}

function whitePixelCount(pixels: Uint8ClampedArray): number {
  let count = 0;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    if (
      pixels[offset] === 255 &&
      pixels[offset + 1] === 255 &&
      pixels[offset + 2] === 255 &&
      pixels[offset + 3] === 255
    ) {
      count += 1;
    }
  }
  return count;
}

describe("图标三态", () => {
  it("正好三态：关 / 开且中继可达 / 开但中继不可达", () => {
    expect(ICON_STATES).toEqual(["off", "on-reachable", "on-unreachable"]);
  });

  it("三态底色两两不同", () => {
    const colors = ICON_STATES.map((state) => ICON_COLORS[state].join(","));
    expect(new Set(colors).size).toBe(ICON_STATES.length);
  });

  it("三态画出来的像素两两不同", () => {
    const rendered = ICON_STATES.map((state) => Array.from(renderIcon(state)).join(","));
    expect(new Set(rendered).size).toBe(ICON_STATES.length);
  });
});

describe("renderIcon", () => {
  it("输出正好一帧 RGBA", () => {
    const pixels = renderIcon("off");
    expect(pixels.length).toBe(ICON_SIZE * ICON_SIZE * 4);
    expect(renderIcon("off", 32).length).toBe(32 * 32 * 4);
  });

  it("底色是该状态的颜色", () => {
    for (const state of ICON_STATES) {
      const pixels = renderIcon(state);
      expect(pixelAt(pixels, 1, ICON_SIZE / 2)).toEqual([...ICON_COLORS[state]]);
    }
  });

  it("每态都画得出白色图样（横杠 / 对勾 / 叹号）", () => {
    for (const state of ICON_STATES) {
      expect(whitePixelCount(renderIcon(state))).toBeGreaterThan(0);
    }
  });

  it("圆角外是透明的", () => {
    expect(pixelAt(renderIcon("off"), 0, 0)[3]).toBe(0);
    expect(pixelAt(renderIcon("off"), ICON_SIZE - 1, ICON_SIZE - 1)[3]).toBe(0);
  });
});

describe("iconTitle · 悬停文案", () => {
  it("关着的时候说清楚没接管页面、点一下能开", () => {
    const title = iconTitle("off");
    expect(title).toContain("总开关已关");
    expect(title).toContain("点击打开开关面板");
  });

  it("开着且中继可达时说清楚可达", () => {
    const title = iconTitle("on-reachable");
    expect(title).toContain("中继可达");
    expect(title).toContain("点击打开开关面板");
  });

  it("开着但中继不可达：原因与启动命令同框（补充要求）", () => {
    const title = iconTitle("on-unreachable", failureNotice("opencode-not-running"));
    expect(title).toContain("中继不可达");
    expect(title).toContain("opencode");
    expect(title).toContain(RELAY_START_COMMAND);
    expect(RELAY_START_COMMAND).toBe("uv run dsb");
    expect(title).toContain("点击打开开关面板");
  });

  it("超时与响应异常也带原因和启动命令", () => {
    for (const kind of ["opencode-timeout", "unexpected-response", "relay-unreachable"]) {
      const title = iconTitle("on-unreachable", failureNotice(kind));
      expect(title).toContain(failureNotice(kind).reason);
      expect(title).toContain("uv run dsb");
    }
  });

  it("没带原因也不至于空着：兜底补上原因与启动命令", () => {
    const title = iconTitle("on-unreachable");
    expect(title).toContain("中继不可达");
    expect(title).toContain("uv run dsb");
  });

  it("每个状态都有自己的文案", () => {
    const rendered = ICON_STATES.map((state) => iconTitle(state));
    expect(new Set(rendered).size).toBe(rendered.length);
  });
});

describe("afterHealthProbe · 周期探活 → 状态位", () => {
  it("总开关关着：探到什么一律原样，不上屏", () => {
    expect(afterHealthProbe("off", true)).toEqual({ state: "off", notice: null });
    expect(afterHealthProbe("off", false)).toEqual({ state: "off", notice: null });
  });

  it("可达就翻回绿、清掉原因", () => {
    expect(afterHealthProbe("on-unreachable", true)).toEqual({
      state: "on-reachable",
      notice: null,
    });
  });

  it("不可达就翻红，挂上原因与启动命令", () => {
    const next = afterHealthProbe("on-reachable", false);
    expect(next.state).toBe("on-unreachable");
    expect(next.notice).toEqual(failureNotice("relay-unreachable"));
    expect(next.notice?.command).toBe(RELAY_START_COMMAND);
  });

  it("同一种探测结果给同一个 notice 引用——background 靠引用判断「没变就别重画」", () => {
    const first = afterHealthProbe("on-reachable", false);
    const second = afterHealthProbe("on-reachable", false);
    expect(first.notice).toBe(second.notice);
  });
});

/** 一份现场，参数就是「走到哪一步、写了多少、还剩多少」。 */
function send(
  phase: SendStatus["phase"],
  written = 0,
  remaining: number | null = null,
): SendStatus {
  return { phase, written, remaining };
}

describe("badgeText · 角标", () => {
  it("关与不可达是硬状态，压过一切——像素画不出来时它要独自把三态撑住", () => {
    expect(badgeText("off")).toBe("关");
    expect(badgeText("off", send("writing", 999, 1))).toBe("关");
    expect(badgeText("on-unreachable")).toBe("!");
    expect(badgeText("on-unreachable", send("queued", 0, 1))).toBe("!");
  });

  it("开着且可达、没有问句在途：不占角标", () => {
    expect(badgeText("on-reachable")).toBe("");
    expect(badgeText("on-reachable", null)).toBe("");
  });

  it("有问句在途就报一个字：等 / 想 / 写 / 完了不占", () => {
    expect(SEND_PHASES.map((phase) => badgeText("on-reachable", send(phase, 1, 1)))).toEqual([
      "等",
      "想",
      "写",
      "",
    ]);
  });
});

describe("等人回（#26）", () => {
  it("有人等着：角标亮「人」，压过在途进度", () => {
    expect(badgeText("on-reachable", null, true)).toBe("人");
    expect(badgeText("on-reachable", send("writing", 128, 52), true)).toBe("人");
  });

  it("关与不可达仍是硬状态，「人」压不过", () => {
    expect(badgeText("off", null, true)).toBe("关");
    expect(badgeText("on-unreachable", null, true)).toBe("!");
  });

  it("没人等着：角标照常", () => {
    expect(badgeText("on-reachable", null, false)).toBe("");
    expect(badgeText("on-reachable", send("running", 1, 1), false)).toBe("想");
  });

  it("悬停里摆出「等人回」的一句话", () => {
    const title = iconTitle("on-reachable", null, null, null, "网页在等人回：选 A 还是 B？");
    expect(title).toContain("网页在等人回：选 A 还是 B？");
  });

  it("悬停里等待现场与等人回都在", () => {
    const title = iconTitle(
      "on-reachable",
      null,
      send("writing", 128, 52),
      null,
      "网页在等人回：选 A 还是 B？",
    );
    expect(title).toContain("正在写答复");
    expect(title).toContain("网页在等人回：选 A 还是 B？");
  });

  it("不可达时手里那句等人回作废，不进悬停", () => {
    const title = iconTitle(
      "on-unreachable",
      failureNotice("relay-unreachable"),
      send("writing", 128, 52),
      null,
      "网页在等人回：选 A 还是 B？",
    );
    expect(title).not.toContain("等人回");
  });

  it("关着时也没有等人回", () => {
    const title = iconTitle("off", null, null, null, "网页在等人回：选 A 还是 B？");
    expect(title).not.toContain("等人回");
  });
});

describe("describeSend · 等待现场的一句话", () => {
  it("阶段各有说法", () => {
    expect(describeSend(send("queued"))).toContain("等模型开工");
    expect(describeSend(send("running"))).toContain("在想");
    expect(describeSend(send("writing"))).toContain("正在写答复");
    expect(describeSend(send("done"))).toContain("写完");
  });

  it("只有在写的时候才报字数——没开写就报 0 字是噪音", () => {
    expect(describeSend(send("queued", 5))).not.toContain("字");
    expect(describeSend(send("running", 5))).not.toContain("字");
    expect(describeSend(send("writing", 128))).toContain("已写 128 字");
  });

  it("剩余时间只在为正时才报：缺着、耗尽、为负都不提", () => {
    expect(describeSend(send("writing", 1, 107.5))).toContain("还剩 108 秒");
    for (const remaining of [null, 0, -3]) {
      expect(describeSend(send("writing", 1, remaining))).not.toContain("还剩");
    }
  });
});

describe("iconTitle · 等待现场进悬停", () => {
  it("开着且可达时把现场摆出来", () => {
    const title = iconTitle("on-reachable", null, send("writing", 128, 52));
    expect(title).toContain("中继可达");
    expect(title).toContain("正在写答复");
    expect(title).toContain("已写 128 字");
    expect(title).toContain("还剩 52 秒");
    expect(title).toContain("点击打开开关面板");
  });

  it("没问句在途就还是原来那一句", () => {
    expect(iconTitle("on-reachable", null, null)).toBe(iconTitle("on-reachable"));
    expect(iconTitle("on-reachable", null, send("writing"))).not.toBe(iconTitle("on-reachable"));
  });

  it("不可达时手里那份进度已经作废，不上屏", () => {
    const title = iconTitle("on-unreachable", null, send("writing", 128, 52));
    expect(title).not.toContain("已写 128 字");
    expect(title).toContain("启动命令");
    expect(title).toContain(RELAY_START_COMMAND);
  });

  it("关着的时候进度更不相干", () => {
    const title = iconTitle("off", null, send("writing", 128, 52));
    expect(title).not.toContain("128");
    expect(title).toContain("总开关已关");
  });
});

describe("iconTitle · 上次故障回看", () => {
  const history = "上次故障 14:49:36（2 分钟前）· 周期探活 · 超时（5000ms 没回），30 秒后恢复";

  it("红过又自己绿了，悬停还答得出为什么红、几点红的、多久绿的", () => {
    const title = iconTitle("on-reachable", null, null, history);
    expect(title).toContain("上次故障 14:49:36");
    expect(title).toContain("周期探活");
    expect(title).toContain("超时（5000ms 没回）");
    expect(title).toContain("30 秒后恢复");
    expect(title).toContain("中继可达"); // 绿着呢，这句还得在
  });

  it("等待现场与历史同框，且现场在前", () => {
    const title = iconTitle("on-reachable", null, send("writing", 128, 52), history);
    expect(title).toContain("正在写答复");
    expect(title).toContain(history);
    expect(title.indexOf("正在写答复")).toBeLessThan(title.indexOf(history));
  });

  it("一次都没红过就没有这句空历史", () => {
    expect(iconTitle("on-reachable", null, null, null)).toBe(iconTitle("on-reachable"));
    expect(iconTitle("on-reachable")).toBe(iconTitle("on-reachable"));
  });

  it("当前正红着时不摆历史——第一句就是原因，重复一遍只是噪音", () => {
    const title = iconTitle("on-unreachable", failureNotice("relay-unreachable"), null, history);
    expect(title).not.toContain("上次故障");
    expect(title).toContain("本机中继 dsb 没有响应");
  });

  it("关着的时候历史更不相干", () => {
    expect(iconTitle("off", null, null, history)).not.toContain("上次故障");
  });
});

describe("角标转速（#28）", () => {
  it("帧按 | / - \\ 循环", () => {
    expect(SPIN_FRAMES).toEqual(["|", "/", "-", "\\"]);
    expect([0, 1, 2, 3, 4, 5].map(spinFrame)).toEqual(["|", "/", "-", "\\", "|", "/"]);
  });

  it("在途时角标显示转速字符，阶段字退场（详情在悬停）", () => {
    expect(badgeText("on-reachable", send("queued"), false, 0)).toBe("|");
    expect(badgeText("on-reachable", send("running"), false, 2)).toBe("-");
    expect(badgeText("on-reachable", send("writing"), false, 3)).toBe("\\");
  });

  it("没传帧的调用方仍拿到阶段字作回退", () => {
    expect(badgeText("on-reachable", send("queued"))).toBe("等");
    expect(badgeText("on-reachable", send("running"))).toBe("想");
    expect(badgeText("on-reachable", send("writing"))).toBe("写");
  });

  it("硬状态与「人」压过转速帧", () => {
    expect(badgeText("off", send("queued"), false, 2)).toBe("关");
    expect(badgeText("on-unreachable", send("queued"), false, 2)).toBe("!");
    expect(badgeText("on-reachable", send("queued"), true, 2)).toBe("人");
  });

  it("答复写完（done）与不在途：不转、清空", () => {
    expect(badgeText("on-reachable", send("done"), false, 2)).toBe("");
    expect(badgeText("on-reachable", null, false, 2)).toBe("");
  });
});

describe("账号处境（#2）", () => {
  it("禁言带解封时刻；没写时刻也说清是禁言", () => {
    expect(describeAccount({ kind: "muted", until: "2026 年 10 月 10 日 20:21" })).toBe(
      "账号禁言至 2026 年 10 月 10 日 20:21，写动作停。",
    );
    expect(describeAccount({ kind: "muted", until: null })).toBe(
      "账号被禁言（页面上没写解封时刻），写动作停。",
    );
  });

  it("未登录指回登录口；ready 与 unknown 不说（不猜）", () => {
    expect(describeAccount({ kind: "signed-out" })).toBe("账号未登录，登录后再用。");
    expect(describeAccount({ kind: "ready" })).toBe("");
    expect(describeAccount({ kind: "unknown" })).toBe("");
  });

  it("悬停：开着且可达时，禁言与未登录都进悬停", () => {
    expect(
      iconTitle("on-reachable", null, null, null, null, {
        kind: "muted",
        until: "2026 年 10 月 10 日 20:21",
      }),
    ).toContain("账号禁言至 2026 年 10 月 10 日 20:21，写动作停。");
    expect(iconTitle("on-reachable", null, null, null, null, { kind: "signed-out" })).toContain(
      "账号未登录，登录后再用。",
    );
  });

  it("悬停：关、不可达、ready 都不带账号处境", () => {
    const muted: AccountState = { kind: "muted", until: "x" };
    expect(iconTitle("off", null, null, null, null, muted)).not.toContain("禁言");
    expect(iconTitle("on-unreachable", null, null, null, null, muted)).not.toContain("禁言");
    expect(iconTitle("on-reachable", null, null, null, null, { kind: "ready" })).not.toContain(
      "账号",
    );
    expect(iconTitle("on-reachable")).not.toContain("账号");
  });
});
