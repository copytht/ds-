/**
 * 工具栏图标即状态位（spec #9 配置与 UI）：三态 —— 关 / 开且中继可达 / 开但中继不可达。
 *
 * 图标由纯函数现画像素（不带图片资源），悬停文案由纯函数现拼，
 * 所以三态长什么样、悬停说不说得出原因与启动命令，都能被单测断言。
 * background 只负责把结果交给 `browser.action`，并把点击接到总开关上。
 */

import { RELAY_START_COMMAND, type FailureNotice } from "./reply";

export type IconState = "off" | "on-reachable" | "on-unreachable";

export const ICON_STATES: readonly IconState[] = ["off", "on-reachable", "on-unreachable"];

/** 图标边长（manifest 图标的常见尺寸）。 */
export const ICON_SIZE = 16;

/** 三态的底色：灰=关，绿=开且可达，红=开但不可达。 */
export const ICON_COLORS: Readonly<Record<IconState, readonly [number, number, number, number]>> = {
  off: [107, 114, 128, 255],
  "on-reachable": [47, 158, 68, 255],
  "on-unreachable": [224, 49, 49, 255],
};

/** 7×7 白色前景图样：横杠 / 对勾 / 叹号。 */
const GLYPHS: Readonly<Record<IconState, readonly string[]>> = {
  off: [".......", ".......", ".......", ".#####.", ".#####.", ".......", "......."],
  "on-reachable": [".......", "......#", ".....#.", ".#...#.", "..#.#..", "...#...", "......."],
  "on-unreachable": ["..###..", "..###..", "..###..", "..###..", ".......", "..###..", "......."],
};

const CLICK_HINT = "点击切换总开关。";

/** 悬停文案：关与可达各自一句话，不可达必须带上原因与启动命令。 */
export function iconTitle(state: IconState, notice?: FailureNotice | null): string {
  if (state === "off") return `ds-：总开关已关，扩展没有接管页面。${CLICK_HINT}`;
  if (state === "on-reachable") return `ds-：总开关已开，中继可达。${CLICK_HINT}`;
  const shown =
    notice ??
    ({
      title: "中继不可达",
      reason: "本机中继 dsb 没有响应。",
      command: RELAY_START_COMMAND,
    } satisfies FailureNotice);
  return `ds-：${shown.title} ${shown.reason} 启动命令：${shown.command}。${CLICK_HINT}`;
}

function isInsideRoundedRect(x: number, y: number, size: number, radius: number): boolean {
  const cx = x + 0.5;
  const cy = y + 0.5;
  const nearX = Math.min(cx, size - cx);
  const nearY = Math.min(cy, size - cy);
  if (nearX >= radius || nearY >= radius) return true;
  const dx = radius - nearX;
  const dy = radius - nearY;
  return dx * dx + dy * dy <= radius * radius;
}

/** 画一个状态的图标：圆角方块底色 + 白色图样，输出 RGBA 像素。 */
export function renderIcon(state: IconState, size = ICON_SIZE): Uint8ClampedArray<ArrayBuffer> {
  const pixels = new Uint8ClampedArray(size * size * 4);
  const [red, green, blue, alpha] = ICON_COLORS[state];
  const radius = Math.max(1, Math.round(size / 4));

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (!isInsideRoundedRect(x, y, size, radius)) continue;
      const offset = (y * size + x) * 4;
      pixels[offset] = red;
      pixels[offset + 1] = green;
      pixels[offset + 2] = blue;
      pixels[offset + 3] = alpha;
    }
  }

  const glyph = GLYPHS[state];
  const rows = glyph.length;
  const columns = glyph[0]?.length ?? 0;
  const scale = Math.max(1, Math.floor((size - 2) / Math.max(rows, columns)));
  const originX = Math.floor((size - columns * scale) / 2);
  const originY = Math.floor((size - rows * scale) / 2);

  for (let row = 0; row < rows; row += 1) {
    const line = glyph[row] ?? "";
    for (let column = 0; column < columns; column += 1) {
      if (line[column] !== "#") continue;
      for (let dy = 0; dy < scale; dy += 1) {
        for (let dx = 0; dx < scale; dx += 1) {
          const x = originX + column * scale + dx;
          const y = originY + row * scale + dy;
          if (x < 0 || y < 0 || x >= size || y >= size) continue;
          const offset = (y * size + x) * 4;
          pixels[offset] = 255;
          pixels[offset + 1] = 255;
          pixels[offset + 2] = 255;
          pixels[offset + 3] = 255;
        }
      }
    }
  }

  return pixels;
}
