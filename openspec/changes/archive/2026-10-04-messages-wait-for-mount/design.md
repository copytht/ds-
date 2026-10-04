# Design

## Context

`messages.list` / `messages.last` 在列表刚挂上、滚动几何还没就位时读，
`readMessages` 写 `scrollTop` 是空操作 → 抛 `page-changed`「滚不动消息列表」；
`readLast` 一行都没读到 → 抛 `page-changed`「认不出消息行」（issue #40）。
`wait.ts` 在 #37 已经为「列表晚挂载」立了规矩：`viewWithin(deadline)` 在预算内
轮询 `conversation()`，到期才抛 `page-changed`——同一个病，`wait.*` 那边已经治好。

## Goals / Non-Goals

**Goals:**

- 读动作在预算内等就绪（列表找得到、滚动层滚得动、至少读得出一行），
  消除「没就绪被报成结构变了」的间歇失败。
- 零线协议改动：不新增失败码，不动 `protocol/fixtures/action.json`。

**Non-Goals:**

- 不给 `messages.*` 加 `timeout` 入参（动作契约不变）。
- 不改「结构真的变了」的路径——`conversation()` 找不到列表照旧当场抛。
- 不碰 `wait.*`、`page.state` 等其余动作。

## Decisions

1. **沿用 `wait.ts` 的预算轮询，不造新机制。**
   `wait.ts` 的 `viewWithin`（`POLL_INTERVAL_MS` 轮询 + 到期才抛）就是
   为这个病立的（#37）。读动作复用同一套：一个「等就绪」helper，
   预算内轮询，到点才抛。理由——一处机制、一处判据，调用方零改动。
   备选（各自排除）：加 `not-ready` 码 → 动三处契约、调用方得学新码；
   让调用方重试 → 把时序问题外推（issue 里已排除）。

2. **就绪 = 三个条件同时成立。** `conversation()` 非空 **且** 滚动层
   `scrollsVertically` 为真 **且** 至少一行 `readRow` 非空。
   前两个对应 `readMessages` 的「滚不动」，第三个对应 `readLast` 的
   「认不出消息行」——把两个抛点的病因都罩住。

3. **固定内部预算，比 25s 扫描预算短。** 真机上虚拟列表挂一屏约
   ~190ms（#37 量过），「没就绪」是秒级窗口。`messages.*` 又没有
   `timeout` 入参可复用，故取一个固定的就绪预算（量级几秒），
   不复用 25s 的 `SWEEP_BUDGET_MS`——否则真失败要白等 25s 才报。

4. **结构变了不进轮询。** `conversation()` 回 null（锚点失效）时
   照旧当场 `page-changed`，不等——轮询只罩「挂着但没就位」，
   不罩「根本找不到」。

## Risks / Trade-offs

- [页面挂得很慢] → 就绪预算按「挂一屏 ~190ms」量级取秒级，够用；
  真慢到超时，回 `page-changed`（与今天同码，只是晚几秒）。
- [轮询掩盖真回归] → 预算封顶，到点仍读不出照样抛，不会静默吞错。
- [jsdom 不做布局] → 滚动用替身喂（`clientHeight`/`scrollHeight`/
  `scrollTop` 可写的假视口），与既有 `messages.test.ts` 的
  `virtualScreens` 替身同一路数。

## Migration Plan

无迁移——纯扩展侧逻辑，线协议不动，旧扩展与新扩展行为一致
（旧扩展在没就绪时报 `page-changed`，新扩展等就绪）。

## Open Questions

（无——就绪判据与预算量级已由 #40 的真机样本与 #37 的挂载测量定死。）
