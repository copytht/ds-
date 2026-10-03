# Spec Delta

## Purpose

出站前的账号处境判定与退避：站点处罚期间停止把写动作推给页面，按阶梯退避，到点后先探活再恢复。出站口本身（ADR-0002 的唯一出站口与 3~5s 窗口）不在本能力范围内。

## ADDED Requirements

### Requirement: 处罚期间停发

扩展在 `page.state` 认出账号处境为 `muted`（处罚句同时提到「账号/你」与「禁言/封禁」，解封时刻认不出也算）时，写动作 SHALL NOT 推给页面执行，当场回 `backing-off`。

#### Scenario: 禁言中提交写动作

- **WHEN** 中继提交一个写动作（`composer.type` / `composer.clear` / `send.click` / `send.enter` / `chat.new`），且扩展侧判定的账号处境是 `muted`
- **THEN** 动作不进入内容脚本，结果为 `{"ok": false, "error": "backing-off"}`

#### Scenario: 禁言中提交只读动作

- **WHEN** 中继提交一个只读动作（`tabs.list` / `page.state` / `composer.read` / `messages.list` / `messages.last`），且账号处境是 `muted`
- **THEN** 动作照常执行——只读不受退避影响，人与 agent 始终能读处境

#### Scenario: 处罚句认不出时刻

- **WHEN** 处罚句在，但解封时刻抠不出来（`until` 为 `null`）
- **THEN** 按退避态处理：阶梯退避有终点，不无限停发

### Requirement: 退避按阶梯增长并持久化

退避时长 SHALL 按阶梯取：第一回 10 分钟，之后每回乘 2，封顶 8 小时。退避终点 MUST 写进扩展持久存储，重启后仍记得。

#### Scenario: 同一账号再次进处罚区

- **WHEN** 账号在退避结束后再次认出处罚句
- **THEN** 本次退避时长是上次的 2 倍（封顶 8 小时），且从持久存储读到的上次时长开始算

#### Scenario: 扩展重启

- **WHEN** 退避进行中扩展重启
- **THEN** 重启后仍在退避中，剩余时长从持久存储里的终点算

### Requirement: 到点后先探活再恢复

长休到解封时刻（或退避到期）后，写动作 SHALL NOT 自动恢复；第一笔写动作 MUST 先做一次只读判定，确认写作框真的在页面上，才恢复放行。

#### Scenario: 解封时刻到了但写作框还没渲染

- **WHEN** 到了解封时刻，第一笔写动作进来，页面写作框仍未渲染
- **THEN** 该笔动作回 `backing-off`，不放行；下一笔再探

#### Scenario: 解封时刻到了且写作框在

- **WHEN** 到了解封时刻，第一笔写动作进来，页面写作框在
- **THEN** 动作照常放行，处境回到正常

### Requirement: 失败码在册

`backing-off` SHALL 进失败码册子，与 `protocol/fixtures/action.json`、`dsb/actions.py` 的 `ACTION_ERRORS`、`tests/test_actions.py` 的断言同一份（三处同步，ADR-0010 的规矩）。

#### Scenario: 册子外的码漏不出

- **WHEN** 执行器抛一个册子外的 `PageError`
- **THEN** 收信那层照旧折成 `tab-gone`（既有判据，本能力不改）
