# Proposal

## Why

`messages.list` / `messages.last` 在页面**还在挂载**时读，会回
`page-changed`——把「没就绪」报成了「结构变了」（issue #40）。调用方拿到
`page-changed` 会当成站点换版 / 锚点失效，误导排查方向；间歇复现（连打三次
`messages.list` 就有一次失败）也让真机复验不可靠。

## What Changes

- `messages.list` / `messages.last` SHALL 在**预算内轮询等就绪**（列表找得到、
  滚动层真的滚得动、且能读出至少一行），耗尽才报 `page-changed`。
- 沿用 `wait.ts` 在 #37 立起来的 `viewWithin` 预算轮询模式（`POLL_INTERVAL_MS`
  轮询 + 到期才抛），**不新增失败码**——线协议契约不动。
- 「结构真的变了」（`conversation()` 根本找不到列表）的路径**不受影响**，
  照旧当场 `page-changed`。

## Capabilities

### New Capabilities

（无——不新增能力。）

### Modified Capabilities

- `site-dom`：给 `messages.*` 加「预算内等就绪」的 requirement（现有
  `wait.* 等挂载` 那条已经为 `wait.*` 定了同样的规矩，本次把同一套规矩
  扩到读动作）。

## Impact

- 受影响代码：`src/lib/messages.ts`（`listMessages` / `lastMessage` /
  `readMessages` / `readLast` / `conversation` 的就绪判定）。
- 不受影响：线协议（`protocol/fixtures/action.json` 的 8 个失败码一个不动）、
  `wait.*`、`page.state` 等其余动作、Python 侧契约。
- 测试：`src/lib/messages.test.ts` 补「列表晚挂载 → 等到，不报 page-changed」
  与「到点仍读不出 → 才报 page-changed」两条；jsdom 不做布局，滚动用替身喂。
