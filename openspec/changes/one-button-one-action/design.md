# Design

## Context

#15 的名册按**意图**划分最小单元，第 8 条「点发送按钮」与第 10 条「点停止生成」是两个单元。
站点的形状是把这两个单元压进同一个 DOM 元素（真机 2026-10-04：class 一个不换、`aria-label`
为空，只有 `svg path` 的 `d` 不同，方块 16×16、箭头同为 16×16）。

**一个按钮只能对应一个最小单元。** 于是名册该按控件分：一个 `button.click`（写）+
一个 `button.get`（读），后者沿用 `think.get`/`think.set`、`search.get`/`search.set`
已成型的形状（`docs/page-actions.md` v1）。图标是**控件此刻承载什么意图**的信号，属于
读面，不属于命中判据。

现状的三个矛盾（合并后一并消失）：

- `findSendButton()` 只看 selector + `disabled` → 生成期把停止键当发送键（#32）。
- `findStopButton()` 认方块图标 → 与上面那句对同一元素给出相反答案。
- 「生成分两相，停止键只认停止相」那条 requirement 存在的唯一理由，是怕 `stop.click`
  误点思考期的环形 spinner——合并后没有独立的停止动作，这条约束自动失效。

## Goals / Non-Goals

**Goals:**

- 一个动作 `button.click`：可用就点，判据里没有意图。
- 一个读动作 `button.get`：`{ pressed }` 报告此刻图标，不点。
- 图标口径只剩一处、只挂在 `button.get` 上；换图标最多让 `get` 少报一种值，不影响 `click`。

**Non-Goals:**

- 不新增失败码（`page-changed` 够用：控件不在或不可用）。
- 不碰 `send.enter` / `composer.*` / `messages.*`。
- 不给 `button.click` 加 `params`（读结果当前态由 `button.get` 负责，不做入参——见决策 3）。

## Decisions

1. **合并成 `button.click` + `button.get`，动作名只描述控件。** `send.click` 这个名字
   本身就是把意图当身份；它在生成期注定撒谎。

2. **图标完全不参与命中判据。** `button.click` 只看「圆键在 + 可用」：方块态也照点，
   因为那就是停止，是页面自己的语义。图标唯一去处是 `button.get` 的返回——**人类看图标
   就知道自己在点什么**，agent 照做即可（先读后写）。认不出回 `unknown` 而不是失败：
   「键在、但不知道是什么」是有效事实，「键不在」才是异常（`page-changed`）。

3. **`button.click` 一律进 speak 闸，不按 `button.get` 的结果动态放行。** 用户 2026-10-05
   点头。理由：闸的意义是「我不在的时候不许替我开口」，而点击结果在闸关着时**判不出**
   （那正是 `unknown` 的情形）——保守即正确。代价：禁言期间连「停一次生成」都点不了，
   已知且接受。动态放行要把读结果当入参，既开 TOCTOU 窗口，又让写动作依赖读。

4. **`STOP_SELECTOR`（`aria-label` 含「停止」兜底）一并退役。** 它存在的唯一目的是给
   `stop.click` 多一条认法。合并后没有第二个动作需要它——`button.click` 的锚点就是那个
   圆键。站点若将来把停止拆成独立元素，那是 `site-dom` 的新事实，届时另记。

5. **`circleIconPath()` 迁进 `button.get` 那一侧**，`STOP_ICON_PREFIX` →
   `BUTTON_ICON_PREFIXES`（箭头 = send、方块 = stop，一处一对，只服务读面）。

## Risks / Trade-offs

- [~~思考期那个禁用环形 spinner：证据缺口~~ 已补（2026-10-05 真机）] 原以为「它带不带
  `ds-button--disabled`」未知。抓到了：思考期圆键是 `<div class="ds-loading">` 里的
  `<svg viewBox="0 0 36 36" data-icon="spin">`，**带 `ds-button--disabled`**，所以
  `button.click` 的可用性判据自动挡回 `page-changed`（正是决策 2 预期的），`button.get`
  则读出 `unknown`（图标既非箭头也非方块）。真机 DOM 已落成回归常量（`page.test.ts`）。
- [禁言期点不了停止键] —— 决策 3 的已知代价，用户已点头。
- [名册从 #15 的 15 条变 14 条 + 1 条读动作] —— #15 已关票，合并属**修订**，要在票里记。
- [换图标只影响 `get`] —— 有意如此：`click` 的可用性判据与图标无关，比原来更抗改版。
