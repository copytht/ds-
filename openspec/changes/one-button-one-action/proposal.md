# Proposal

## Why

站点把**两个意图压进了一个按钮**：写作框旁那个圆键生成期原地变停止键——class 一个不换、
`aria-label` 为空，只有里面的图标从箭头变成方块（真机 2026-10-04 两次抓取）。

名册按意图把它分成了两个动作（#15 第 8 条「点发送按钮」、第 10 条「点停止生成」），于是
`findSendButton` 与 `findStopButton` **对同一个元素给出矛盾判断**：`send.click` 在生成期
照样命中它，会静默把「发送」点成「停止」（#32）。图标判据只是这个矛盾的补丁——治的是
两个动作抢一个键。

按 #15 的最小单元原则——**一个按钮只能对应一个最小单元**——正确形状是合并：
一个 `button.click`（点那个控件），读的部分独立成 `button.get`（先读后写，和
`think.get`/`think.set`、`search.get`/`search.set` 同一形状）。图标随之降级：**只出现在
`button.get` 的返回里当事实报告**，绝不参与命中判据。

## What Changes

- 名册：`send.click` + `stop.click` → **`button.get`**（读）+ **`button.click`**（写）。
- `button.click`：命中 = 圆键在 + 可用（`ds-button--disabled` / 没渲染出盒子都不算）；
  **判据不含意图**——方块态也照点（那就是停止，页面自己的语义）；返回 `{}`。
- `button.get`：返回 `{ pressed: "send" | "stop" | "unknown" }`——就是**人类看图标那一眼**；
  图标认不出回 `unknown`（成功），圆键整个不在才回 `page-changed`。
- `button.click` 一律进 **speak 闸**（"代你开口"）**+ 退避闸**：闸关着就点不了，哪怕此刻它
  其实是停止键。判不出意图时不许动（fail-safe），不为动态放行引入 TOCTOU。
- 退役：`findStopButton` / `stopClick` / `STOP_SELECTOR` 兜底 / `STOP_ICON_PREFIX`
  （整套只为认图标而存在）、两条 requirement（「同一元素多态按图标 `path` 判别」与
  「生成分两相，停止键只认停止相」）。
- `send.enter` 不动：它不经过圆键，是意图明确的发送路径（#15 第 9 条）。

## Capabilities

### Modified Capabilities

- `frontend`：「动作 fail-safe」与「控件定位优先设计系统语义锚」补上合并后的形状（图标从
  **定位判据**降为**状态报告**手段）。
- `site-dom`：新增一条，把「圆键两态同元素」这个站点事实记在案（附真机证据）。

### Removed Capabilities

- `frontend`：「同一元素多态按图标 `path` 判别」——没有多态了，一个键一个动作。
- `frontend`：「生成分两相，停止键只认停止相」——没有 `stop.click` 了。

## Impact

- 代码：`src/lib/page.ts`（合并 finder / 两个执行器）、`src/lib/action.ts`（两份闸名单）、
  `entrypoints/content.ts`（`ACTION_ROSTER`）。
- 测试：`src/lib/page.test.ts`（`stop.click 执行器` 那组重写）、`src/lib/action.test.ts`。
- 契约：`protocol/fixtures/action.json`（两条成功样例合并 + 新增 `button.get`）。
- 文档：`README.md:71` 的 `stop.click` 例子。
- 票：**#32 的问题因合并不复存在**（`send.click` 没了）；**#21**（`stop.click` 已关）的实现
  被并入 `button.click`——两票都要记一笔合并。
- 无调用方受影响：`deliverNudge` 走 `send.enter`。
