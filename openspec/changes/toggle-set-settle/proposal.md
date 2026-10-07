## Why

#81：`think.set` / `search.set` 点完**同步**回读 `aria-pressed`，站点异步生效时读到旧值，返回 `{enabled:false}`
——把「还没生效」误报成「被拒」。`site-dom` spec 早就要求回**达成态**并明说「站点可能异步生效」，实现违背了本意。
2026-10-07 真机复现：点开后立即读是 `false`，约几百毫秒后页面才变开，再 `think.get` 是 `true`。

## What Changes

- `setThink` / `setSearch` 点完后**轮询** `aria-pressed`：到目标态就收；超过 1500ms 上限按当时读到的收（上限内站点不拨就当被拒）。
  执行器变 async（名册类型本就允许，`messages.list` 已是）。
- `site-dom` spec：MODIFIED「两个小开关按文字认控件」——写明「等它稳定」与上限；新增场景「站点异步生效」；
  「站点拒了这一拨」补上「等满上限」。
- `scripts/page-action.py toggles-off`：去掉自己绕过这个问题的轮询，信任 `set` 的返回。
- **不做**：别的写动作（`chat.switch` / `message.*` / `code.*`）的回读——它们本就不回读，约定是点完回 `{}`。

## Capabilities

### New Capabilities

- (none)

### Modified Capabilities

- `site-dom`: 开关 `set` 点完等稳定再回达成态，补「站点异步生效」场景

## Impact

- `src/lib/page.ts`（`setToggleOption` → async，`setThink` / `setSearch` 跟着）、`src/lib/page.test.ts`
- `scripts/page-action.py`（`toggles_off` 简化）
- `protocol/fixtures/action.json`：形状不变，不改
- `openspec/specs/site-dom/spec.md`（经归档同步）
- 不改失败码册子、不改 `ACTION_ROSTER` 键、不改闸门
