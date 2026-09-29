import { describe, expect, it } from "vitest";

import { ICON_COLORS, ICON_SIZE, ICON_STATES, iconTitle, renderIcon } from "./icon";
import { failureNotice, RELAY_START_COMMAND } from "./reply";

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
    expect(title).toContain("点击切换总开关");
  });

  it("开着且中继可达时说清楚可达", () => {
    const title = iconTitle("on-reachable");
    expect(title).toContain("中继可达");
    expect(title).toContain("点击切换总开关");
  });

  it("开着但中继不可达：原因与启动命令同框（补充要求）", () => {
    const title = iconTitle("on-unreachable", failureNotice("opencode-not-running"));
    expect(title).toContain("中继不可达");
    expect(title).toContain("opencode");
    expect(title).toContain(RELAY_START_COMMAND);
    expect(RELAY_START_COMMAND).toBe("uv run ds-mcp");
    expect(title).toContain("点击切换总开关");
  });

  it("超时与响应异常也带原因和启动命令", () => {
    for (const kind of ["opencode-timeout", "unexpected-response", "relay-unreachable"]) {
      const title = iconTitle("on-unreachable", failureNotice(kind));
      expect(title).toContain(failureNotice(kind).reason);
      expect(title).toContain("uv run ds-mcp");
    }
  });

  it("没带原因也不至于空着：兜底补上原因与启动命令", () => {
    const title = iconTitle("on-unreachable");
    expect(title).toContain("中继不可达");
    expect(title).toContain("uv run ds-mcp");
  });

  it("每个状态都有自己的文案", () => {
    const rendered = ICON_STATES.map((state) => iconTitle(state));
    expect(new Set(rendered).size).toBe(rendered.length);
  });
});
