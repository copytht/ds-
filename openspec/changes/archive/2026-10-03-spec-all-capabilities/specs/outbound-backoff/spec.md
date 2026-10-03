# Spec: outbound-backoff

## Purpose

出站前的账号处境判定与退避：站点处罚期间停止把写动作推给页面，按阶梯退避，到点后先探活再恢复。出站口本身（ADR-0002 的唯一出站口与 3~5s 窗口）原样保留，不在本能力范围内。

## Requirements

### 处罚期间停发

扩展在 `page.state` 认出账号处境为 `muted` 时，写动作 SHALL NOT 推给页面执行，当场回 `backing-off`。只读动作（`tabs.list`、`page.state`、`composer.read`、`messages.*`）永不受影响。

### 退避按阶梯增长并持久化

退避时长 SHALL 按阶梯取：第一回 10 分钟，之后每回乘 2，封顶 8 小时。退避终点 MUST 写进扩展持久存储，重启后仍记得。

### 到点后先探活再恢复

长休到解封时刻（或退避到期）后，写动作 SHALL NOT 自动恢复；第一笔写动作 MUST 先做一次只读判定（确认写作框在页面上），才恢复放行。

### 失败码在册

`backing-off` SHALL 进失败码册子，与 `protocol/fixtures/action.json`、`dsb/actions.py` 的 `ACTION_ERRORS`、`tests/test_actions.py` 的断言同一份（三处同步，ADR-0010）。
