# Tasks

## 1. 预算共享（含测试）

- [x] 1.1 `parseWaitSeconds` 与 `listMessages` / `lastMessage` 按 `parseWaitSeconds(frame)` 算**一次** `deadline`，`readyWithin` 与 `readMessages` 都收它。
      **实施时发现的设计缺口（原 design 决定 1 没料到）**：`wait.ts` 要用 `messages.ts` 的
      `ROW_SELECTOR` / `conversation` / `nextFrame`，所以 `messages.ts` **不能引 `wait.ts`**——
      直接引会成循环依赖（vitest 模块求值卡死，连 `--testTimeout` 都不生效）。
      修法（比原方案多一步，但结论不变：口径只有一处）：把**纯口径**（`POLL_INTERVAL_MS` /
      `FRAME_FALLBACK_MS` / `parseWaitSeconds` 及三个秒常数）搬进新文件 `src/lib/wait-budget.ts`
      （无依赖），两边都引它；`wait.ts` 从那里转出，对外接口与旧版一字不差。
      验证：`messages.test.ts` 三条预算测试过（共用一份 / 到点抛 `read-failed` / 四态钳位）。
- [x] 1.2 退役 `READY_BUDGET_MS` 与 `SWEEP_BUDGET_MS`（预算由 `timeout` 定）；「真机挂一屏约 190ms」留在文件头注释里当背景，不留在常数上。验证：`grep -n "READY_BUDGET_MS\|SWEEP_BUDGET_MS" src/lib/messages.ts` 无命中（见任务 1.3 的实际结果）。

## 2. 钳位与非法值（含测试）

- [x] 2.1 `messages.test.ts` 补「`timeout` 缺省/非法/超上限/低于下限」四态断言（与 `wait.test.ts` 的 `parseWaitSeconds` 既有断言同口径）。验证：该条通过；`wait.test.ts` 19 条不回归。

## 3. 契约同步

- [x] 3.1 `protocol/fixtures/action.json` 补两条：`messages.list` 带 `timeout: 25`、`messages.last` 带 `timeout: 5`（后者照 spec「last 与 list 同一口径」）。验证：TS 侧 `action.test.ts` + `fixtures.test.ts` 52 条过；Python 侧 `tests/test_fixtures.py` 10 条过（两侧共读同一份 fixture）。

## 4. 门

- [x] 4.1 `pnpm quality` 全绿。验证：**490 vitest + 143 pytest**，`All checks passed!`，退出码 0。
- [x] 4.2 真机（限速、`--pace` 已有）：`messages.list --params '{"timeout": 25}'` 回 `ok:true`、
      **12 条、角色序列 `UAUAUAUAUAUA` 全对**；`messages.last --params '{"timeout": 5}'`（短预算）
      回 `ok:true` 并读到最后一条。**两个入参都被接受**。
      踩到的坑：后台标签页（`visibilityState: hidden`）下第一发回 `read-failed`——那是环境节流，
      不是预算改动的问题；把标签页切前台即过（上一轮已记录同一限制）。
- [x] 4.3 spec 同步：delta 用 `## MODIFIED Requirements` 整块改写「`messages.*` 在预算内等就绪」那条（含 `params.timeout` 口径与「两段共用一份」），archive 时并进主 spec。验证：`openspec validate --all --strict` 6 passed（含本 change）。

## 回滚点

- 预算共享若真机出问题，可退回「两段各自独立计时」——但那意味着最坏 30s 顶锁，
  回滚等于把 #40 修掉的谎报请回来。优先修好而不是回滚。
