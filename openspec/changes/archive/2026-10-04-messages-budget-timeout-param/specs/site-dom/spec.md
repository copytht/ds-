# Spec Delta

## MODIFIED Requirements

### Requirement: `messages.*` 在预算内等就绪

`messages.list` / `messages.last` SHALL 在预算内轮询等消息列表就绪
（至少一行 `readRow` 读得出正文）；到点仍读不出才报 `page-changed`。
预算 SHALL 由 `params.timeout`（秒）决定，口径与 `wait.*` 一致：缺省 25、钳在 `[1, 25]`、
非法值按缺省。**就绪等待与扫描 SHALL 共用这一份预算**——就绪花掉的时间从扫描里扣，
不是各自独立计时，因此最坏耗时恒等于预算。结构真的变了（`conversation()` 根本找不到列表）
MUST 照旧当场 `page-changed`，不进轮询。沿用 `wait.ts` 的预算轮询模式，不新增失败码。

#### Scenario: 列表晚挂载

- **WHEN** 动作到达时列表 / 滚动层还没挂好，且预算内又就绪了
- **THEN** 正常读出消息，不报 `page-changed`

#### Scenario: 到点仍读不出

- **WHEN** 预算耗尽仍读不出任何一行
- **THEN** 报 `page-changed`（这回是真的「结构变了」）

#### Scenario: 结构真的变了

- **WHEN** `conversation()` 根本找不到列表（锚点失效）
- **THEN** 当场报 `page-changed`，不进入轮询

#### Scenario: 两段预算共用一份

- **WHEN** `messages.list` 给了 `timeout: 25`，而就绪等待花掉了 5 秒
- **THEN** 扫描只剩 20 秒可用，最坏总耗时 25 秒——不会被中继的锁吞成 `timeout`

#### Scenario: 预算按入参钳位

- **WHEN** `timeout` 缺省、非法（非数 / NaN）、超上限或低于下限
- **THEN** 分别按 25 / 25 / 25 / 1 秒处理，与 `wait.*` 同一套 `parseWaitSeconds` 口径

#### Scenario: last 与 list 同一口径

- **WHEN** `messages.last` 也传 `timeout`
- **THEN** 同样被接受并照此定预算，不因为「只读最后一屏」就另立特例
