# Spec Delta

## ADDED Requirements

### Requirement: 圆键两态同元素

站点把「发送」与「停止」压进**同一个** DOM 元素：写作框旁的圆键
（`div[role="button"].ds-button--primary.ds-button--filled.ds-button--circle`）在生成期原地
变停止键——`class` 一个不换、`aria-label` 为空，只有 `svg path` 的 `d` 不同（箭头
`M8.3125 0.980206…` = 发送、方块 `M2 4.88C2 3.68009…` = 停止，两者同为 16×16）。真机
2026-10-04 抓取两次（生成中 / 空闲），落成 `src/lib/page.test.ts` 的回归常量。

这是**站点形状**，记在这里供换版时比对；MUST NOT 被吸收成我们的契约（名册按控件分，
见 `frontend` 的「一个按钮一个动作」）。

#### Scenario: 生成期原地换图标

- **WHEN** 生成开始，圆键里的箭头换成方块
- **THEN** 元素引用不变、`class` 不变、`aria-label` 仍为空，只有图标 `d` 变

#### Scenario: 思考期环形 spinner

- **WHEN** 页面在思考期，圆键位置显示一个环形 spinner（真机 2026-10-05 抓）
- **THEN** 它是 `<div class="ds-loading">` 里的 `<svg viewBox="0 0 36 36" data-icon="spin">`，
  **带 `ds-button--disabled`**——所以可用性判据就挡住点击，`button.get` 报 `unknown`
  （图标既非箭头也非方块）。真机 DOM 落成 `src/lib/page.test.ts` 的回归常量
