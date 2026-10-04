# Spec Delta

## ADDED Requirements

### Requirement: `messages.*` 在预算内等就绪

`messages.list` / `messages.last` SHALL 在预算内轮询等消息列表就绪
（列表找得到、滚动层真的滚得动、且能读出至少一行）；到点仍读不出才报
`page-changed`。结构真的变了（`conversation()` 根本找不到列表）MUST
照旧当场 `page-changed`，不进轮询。沿用 `wait.ts` 的预算轮询模式
（`POLL_INTERVAL_MS` 轮询 + 到期才抛），**不新增失败码**。

#### Scenario: 列表晚挂载

- **WHEN** 动作到达时列表 / 滚动层还没挂好（虚拟列表的滚动几何未就位，
  写 `scrollTop` 是空操作），且预算内又就绪了
- **THEN** 正常读出消息，不报 `page-changed`

#### Scenario: 到点仍读不出

- **WHEN** 预算耗尽仍读不出任何一行
- **THEN** 报 `page-changed`（这回是真的「结构变了」）

#### Scenario: 结构真的变了

- **WHEN** `conversation()` 根本找不到列表（锚点失效）
- **THEN** 当场报 `page-changed`，不进入轮询
