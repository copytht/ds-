# Design

## Context

`messages.list` 现在两段预算串联：`readyWithin`（5s，上一轮为 #40 加的）+ `readMessages`
扫描（25s）= 最坏 30s，正顶着中继 30s 的锁。`readMessages` 的注释写着 25s 是「留 5s 余量让
真失败报得出来」——那个前提在 #40 之前成立（读动作只花 25s），之后不成立了。

`wait.*` 早就有 `params.timeout`（`parseWaitSeconds`：缺省 25、钳 `[1,25]`、非法按缺省），
`messages.*` 是唯一没有它的读动作，预算只能写死。

## Goals / Non-Goals

**Goals:**

- 最坏耗时**恒等于预算**，恒留中继锁的余量。
- 调用方能按对话长度调预算（长对话用 25s，短的可早失败）。
- 口径与 `wait.*` 完全一致，不另立一套解析。

**Non-Goals:**

- 不新增失败码（8 个码不动）。
- 不改 `wait.*` 的行为。
- 不动后台标签页的节流问题（那是环境限制，`read-failed` 语义已对）。

## Decisions

1. **复用 `parseWaitSeconds`，不另写一份。** 它住在 `wait.ts`（等待域），语义是
   「等多久」——`messages.*` 要的正是同一件事。导出即用；将来若两边都要调
   （比如 `readyWithin` 也想单独配），再说。备选：复制一份到 `messages.ts` —— 判不合格，
   两处解析会漂移。

2. **一份预算、两段共用，deadline 只算一次。** `listMessages` 先算
   `deadline = now + timeout*1000`，`readyWithin` 与 `readMessages` 都收这个 deadline。
   `readMessages` 内部按「deadline - now」判断是否到点，而不是自己的 `SWEEP_BUDGET_MS`。
   理由：两段独立计时的话，总最坏 = 就绪预算 + 扫描预算，无论怎么调常数都可能顶到锁；
   共用一份则**恒等于预算**，而预算上限 25s < 锁 30s，余量恒在。

3. **`SWEEP_BUDGET_MS` 退役，`READY_BUDGET_MS` 退役。** 两者都被 `timeout` 取代。
   留着两个「也是预算」的常数，就是下一个改不动的坑——真机上量过的那句
   「虚拟列表挂一屏约 190ms」写进注释当背景，不写进常数。

4. **`messages.last` 同样收 `timeout`。** 它只读最后一屏（不扫全量），但预算口径统一
   比省一个参数重要；调用方不必记「哪个动作有哪个参数」。

## Risks / Trade-offs

- [短对话上预算显式调小，可能提前 `page-chailed`] → 那是调用方的选择；缺省仍是 25s，
  行为与今天一致。
- [`readMessages` 的 deadline 判据变了（从固定 25s 变成传入）] → 用测试钉住「就绪花掉
  5s 则扫描只剩 20s」，`wait.test.ts` / `messages.test.ts` 既有断言不许回归。
- [`readyWithin` 在预算耗尽时抛 `page-changed`、扫描超预算时抛 `read-failed`] → 两个码
  语义不同（认不出 vs 读不完），刻意分开，别合并。
