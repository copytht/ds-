# 扩展自带的围栏工具（local tools）

## Purpose

定扩展自己在 background **就地执行**的那批围栏工具（不转发 dsb）的触发条件、名册契约、
`send.page` 的行为与错误矩阵，以及必须跟上的测试。

## Requirements

### Requirement: 命中名册就地执行，未命中照旧转发

围栏正文经 `parseToolCall` 后 SHALL 先查 `findLocalTool`：命中则在 background 本地执行，
未命中照旧转发 dsb。截获点 SHALL 在 `entrypoints/background.ts` 的 `sendCall(call, tabId)`
（`parseToolCall` 之后、`fetch` 之前）；普通工具（dsb）路径 MUST NOT 改动。

#### Scenario: 命中

- **WHEN** `tool` 是本地工具名（v1 只有 `send.page`）
- **THEN** 本地执行，一次 `fetch` 都不打

#### Scenario: 未命中

- **WHEN** `tool` 不在名册
- **THEN** 走原路径转发 dsb，一字不改

### Requirement: 名册的形状

本地工具 SHALL 满足固定签名：`LocalTool` 有 `name` / `description` / `params` / `run`，
`run` 收 `(args, env)` 与 `LocalToolEnv`（`tabId` + `run(action, params)`），
`findLocalTool(name)` 找不到回 `null`。

#### Scenario: 元数据的用途

- **WHEN** 工具进协议说明
- **THEN** `name` / `params` / `description` 取自名册，不在别处手写

### Requirement: `send.page` 的契约

`send.page` SHALL 收 `question`（非空字符串，必填）与 `seconds`（可选，缺省 25、钳 1..25，
与 `wait.ts` 同口径）；执行 SHALL 依次为 `composer.type` → `send.enter` → `wait.fence` →
`wait.reply`，全走 `runAction`（总开关 / 替人发言 / 退避三道闸照拦）。

#### Scenario: 成功

- **WHEN** 四步依次成
- **THEN** 把 `wait.reply` 的 `{text}` 经 `parseReplyPayload` 解回正文，`okPayload(正文)` 回灌

#### Scenario: 失败

- **WHEN** 任一步没成
- **THEN** 回 `errorPayload(码)`，码全取现成册子（不新增），且不进对话流（`isInjectableReply` 挡）

### Requirement: `send.page` 不自我转发

组合工具 SHALL 只等、不转发：模型排出的那条围栏由既有路径
（`content → background.onMessage → sendCall`）独立转发 dsb 并回灌，避免双执行。

#### Scenario: 双执行

- **WHEN** 本地组合自己也把模型那条围栏转发给 dsb
- **THEN** 判不合格（同一工具会被执行两次）

### Requirement: 本地工具的失败矩阵

`send.page` SHALL 按固定矩阵回码：不带 tab → `tab-gone`；同标签页已有本地工具在跑 →
`okPayload`（可见提示，不并发）；`question` 缺 / 空 / 非串 → `unknown-action`（不发送）；
总开关关 / 替人发言闸关 → `disabled`；退避中 → `backing-off`；等围栏 / 等回灌 25s 没等到 →
`timeout`；回灌解不出 → `page-changed`。

#### Scenario: 闸关着

- **WHEN** 用户在页面上关着总开关就排了 `send.page`
- **THEN** 回 `disabled`，页面不发送

### Requirement: 本地工具不碰中继图标

本地工具 SHALL NOT `applyOutcome`、MUST NOT 留失败痕（它一次 fetch 都没打，证明不了中继健不健康）；
失败只进控制台。

#### Scenario: 本地工具失败

- **WHEN** 本地工具因闸关回 `disabled`
- **THEN** 中继图标不变红（与 `deliverNudge` 同口径）

### Requirement: 名册元数据与说明文案不许分手

`description` / `params` SHALL 与协议说明文案保持对拍一致，任一边改动即红。

#### Scenario: 改了一边

- **WHEN** 只改了 `description` 没改说明，或反之
- **THEN** `src/lib/instructions.test.ts` 变红

### Requirement: 本地工具不进页面动作名册

本地工具 SHALL 属于**围栏工具名册**（background 执行），MUST NOT 进 `ACTION_ROSTER`
（那是页面动作名册，内容脚本执行）。

#### Scenario: 放错册子

- **WHEN** 把本地工具写进 `ACTION_ROSTER`
- **THEN** 判不合格（两个名册两码事）

### Requirement: 本地工具的测试

SHALL 有 `src/lib/localtools.test.ts`（四步顺序与入参、任一步没成即停并原码回、
`question` 校验、`seconds` 归一、回灌解出正文、解不出回 `page-changed`）、
`src/lib/reply.test.ts`（`buildReply` ↔ `parseReplyPayload` 往返，坏输入回 null）、
`src/lib/instructions.test.ts`（名册元数据与说明文案对拍）。

#### Scenario: 改四步顺序

- **WHEN** 调整 `send.page` 的步骤顺序
- **THEN** `localtools.test.ts` 先红
