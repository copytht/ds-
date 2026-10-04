# Tasks

## 1. 就绪轮询 helper（含单测）

- [x] 1.1 在 `src/lib/messages.ts` 加就绪 helper：预算内轮询等「至少一行 `readRow` 读得出正文」，到期抛 `PageError(ACTION_ERROR_PAGE_CHANGED)`；间隔复用 `wait.ts` 的 `POLL_INTERVAL_MS`（已导出），预算取秒级固定值 `READY_BUDGET_MS = 5_000`（不复用 25s 的 `SWEEP_BUDGET_MS`）。
      **判据与原计划不同（真机实测纠正，2026-10-04）**：原写「滚动层 `scrollsVertically` 为真 **且** 至少一行可读」——
      实测导航后立刻量，主列表 `.ds-virtual-list--printable` 的几何**已完全就绪**（742×1856、`overflow:auto`），
      只是**一行都还没挂进来**（`rows: 0`）。所以就绪判据**只认「读得出行」**：
      几何那半 `conversation()` 已经挑过滚动层了，重复挑会把「jsdom 无布局」误判成「页面没就位」、
      把单测全卡到预算耗尽；滚不滚得动由 `readMessages` 自己的「滚不动消息列表」抛点负责。
      另**不试写 `scrollTop`**（jsdom 里写入永远「成功」，试写测不出东西、还污染别处对写入序列的断言）。
      验证：`messages.test.ts` 7 条新用例全过（晚挂载→等到 / 到点→抛 / 结构变了→不进轮询 / 不写 scrollTop / 两条动作各一条）。

## 2. 接入 `messages.list`（含测试）

- [x] 2.1 `listMessages` 在 `readMessages` 之前先过就绪 helper（`conversation()` 为 null 照旧直接回空数组，不进轮询）。验证：`messages.test.ts`「`messages.list` 走同一条就绪路：就绪后照常读出」通过；既有 3 条无 stub 的 fixture（jsdom 无布局）**零回归**。

## 3. 接入 `messages.last`（含测试）

- [x] 3.1 `lastMessage` 在 `readLast` 之前先过就绪 helper。验证：`messages.test.ts`「`messages.last` 走同一条就绪路」通过。

## 4. 边界用例（含测试）

- [x] 4.1 补「预算耗尽仍读不出任何一行 → 报 `page-changed`」一条。验证：对应测试通过。
- [x] 4.2 补「`conversation()` 根本找不到列表（锚点失效）→ 当场 `page-changed`、不进轮询」一条。验证：对应测试通过（断言 `polls === 0`）。
- [x] 4.3 补「挂着列表但一行都没有 → 也算没就绪，进轮询」（这是真机实测的主症状，别与「空对话」混）。验证：对应测试通过。

## 5. 集成验证

- [x] 5.1 `pnpm quality` 全绿。验证：**446 vitest + 138 pytest**，`All checks passed!`，退出码 0。
- [ ] 5.2 真机复验（限速、单发、随机延迟）：`scripts/env-up.sh --debug` 后，在**刚导航进一条对话**（列表挂上但 `rows: 0` 的那个窗口）立刻发 `messages.list` / `messages.last`，确认等到而不是 `page-changed`。验证：回 `ok:true` 且角色正确。
