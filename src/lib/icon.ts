/**
 * 工具栏图标即状态位（spec #9 配置与 UI）：三态 —— 关 / 开且中继可达 / 开但中继不可达。
 *
 * 图标由纯函数现画像素（不带图片资源），悬停文案由纯函数现拼，
 * 所以三态长什么样、悬停说不说得出原因与启动命令，都能被单测断言。
 * background 只负责把结果交给 `browser.action`，并把点击接到总开关上。
 */

import { FAILURE_RELAY_UNREACHABLE, type AskPhase, type AskStatus } from "./relay";
import { failureNotice, RELAY_START_COMMAND, type FailureNotice } from "./reply";

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

/** 等待期各阶段的一句话：角标只取头一个字，悬停说全。 */
function phaseText(phase: AskPhase): string {
  if (phase === "queued") return "子会话已送出，等模型开工";
  if (phase === "running") return "模型在想";
  if (phase === "writing") return "正在写答复";
  return "答复已写完";
}

/**
 * 等待现场的一句话：走到哪一步、写了多少字、这一段还剩多少预算。
 *
 * 只出现在悬停里（进度不上对话流），所以怎么措辞都归这儿管；
 * 剩余预算是负数或缺着就干脆不提——报一个错的数比不报更糟。
 */
export function describeAsk(progress: AskStatus): string {
  const bits = [phaseText(progress.phase)];
  if (progress.phase === "writing" && progress.written > 0) {
    bits.push(`已写 ${progress.written} 字`);
  }
  const remaining = progress.remaining;
  if (remaining !== null && remaining > 0) bits.push(`还剩 ${Math.ceil(remaining)} 秒`);
  return bits.join("，");
}

/**
 * 角标文字。
 *
 * 关与不可达是**硬状态**，压过一切：像素图标万一画不出来，角标要独自把三态撑住，
 * 所以前两个分支绝不能被等待中的阶段盖掉。开着且可达时，才轮到等待现场的头一个字。
 */
export function badgeText(state: IconState, progress?: AskStatus | null): string {
  if (state === "off") return "关";
  if (state === "on-unreachable") return "!";
  if (!progress) return "";
  return { queued: "等", running: "想", writing: "写", done: "" }[progress.phase];
}

/** 悬停文案：关与可达各自一句话，不可达必须带上原因与启动命令。 */
export function iconTitle(
  state: IconState,
  notice?: FailureNotice | null,
  progress?: AskStatus | null,
): string {
  if (state === "off") return `ds-：总开关已关，扩展没有接管页面。${CLICK_HINT}`;
  // 等待现场只在「开着且可达」时才有意义：不可达时手里那份进度已经作废了。
  const waiting = state === "on-reachable" && progress ? `${describeAsk(progress)}。` : "";
  if (state === "on-reachable") {
    return `ds-：总开关已开，中继可达。${waiting}${CLICK_HINT}`;
  }
  const shown =
    notice ??
    ({
      title: "中继不可达",
      reason: "本机中继 dsb 没有响应。",
      command: RELAY_START_COMMAND,
    } satisfies FailureNotice);
  return `ds-：${shown.title} ${shown.reason} 启动命令：${shown.command}。${CLICK_HINT}`;
}

/**
 * 一次周期探活（`GET /health`）之后的状态位：总开关关着就原样不动，
 * 可达就把原因清掉，不可达才挂上原因与启动命令。
 *
 * 探测结果 → 状态的映射放这儿，是为了让「图标该不该翻脸」可被单测断言；
 * background 只管上屏。可达时清空原因、不可达时给出**同一个** notice 对象
 * （`failureNotice` 对在册错误码返回常量），调用方拿引用比较就知道有没有变化。
 */
export function afterHealthProbe(
  state: IconState,
  reachable: boolean,
): { state: IconState; notice: FailureNotice | null } {
  if (state === "off") return { state: "off", notice: null };
  if (reachable) return { state: "on-reachable", notice: null };
  return { state: "on-unreachable", notice: failureNotice(FAILURE_RELAY_UNREACHABLE) };
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
