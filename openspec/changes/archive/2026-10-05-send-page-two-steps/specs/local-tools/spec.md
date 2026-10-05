# Spec Delta

## MODIFIED Requirements

### Requirement: `send.page` 的契约

`send.page` SHALL 收 `question`（非空字符串，必填）；执行 SHALL 依次为 `composer.type` →
`send.enter` 两步，全走 `runAction`（总开关 / 替你发言 / 退避三道闸照拦）。

它 SHALL 只做「**往页面发一条问题**」这一件：MUST NOT 承诺读回页面的回答，MUST NOT 用
`wait.*` 等页面那一轮的往返——ADR-0014 之后回灌进页面的只有两行短标记，`wait.reply` 等到
的正是 `send.page` 自己触发的那轮回灌（自指），而页面动作**没有 MCP 工具面**，模型也读不到
页面消息。

#### Scenario: 成功

- **WHEN** 两步依次成
- **THEN** 回一个确认（`send.page` 的正文为空——它不取答复），模型从下一次输入里看到页面的新回答

#### Scenario: 失败

- **WHEN** `composer.type` 或 `send.enter` 任一步没成，或 `question` 缺 / 空 / 非串
- **THEN** 回 `errorPayload(码)`，码全取现成册子（不新增），且不进对话流（`isInjectableReply` 挡），**不再往下**；`question` 不成形回 `unknown-action` 且页面不发送

#### Scenario: 缩写口径

- **WHEN** 决定是否保留 `seconds` 参数
- **THEN** 本 change 取**删掉**（收缩成「发一条问题」后没有等待对象，留着会让模型以为要等）；
  若将来加回等动作，这个场景连同参数与钳位一起改

### Requirement: 本地工具的失败矩阵

`send.page` SHALL 按固定矩阵回码：不带 tab → `tab-gone`；同标签页已有本地工具在跑 →
`okPayload`（可见提示，不并发）；`question` 缺 / 空 / 非串 → `unknown-action`（不发送）；
总开关关 / 替你发言闸关 → `disabled`；退避中 → `backing-off`。

> 矩阵里**没有** `timeout` /「回灌解不出 → `page-changed`」那两格——它们属于
> `wait.fence` / `wait.reply` 这两个页面动作（各自仍在那条动作名册里），`send.page`
> 不再走它们，所以它自己既不等也不解。

#### Scenario: 闸关着

- **WHEN** 用户在页面上关着总开关就排了 `send.page`
- **THEN** 回 `disabled`，页面不发送

#### Scenario: 不再有等不到的情形

- **WHEN** 页面模型迟迟不回答
- **THEN** 与 `send.page` 无关——它已经回确认了；页面那侧的回答照旧走正常流程

### Requirement: 本地工具的测试

SHALL 有 `src/lib/localtools.test.ts`（两步顺序与入参、任一步没成即停并原码回、
`question` 校验、回一个空的确认正文）、`src/lib/reply.test.ts`（`buildReply` ↔
`parseReplyPayload` 往返，坏输入回 null）、`src/lib/instructions.test.ts`（名册元数据与说明
文案对拍，且本地工具那段描述**不承诺读回页面回答**）。

#### Scenario: 改四步顺序

- **WHEN** 调整 `send.page` 的步骤顺序
- **THEN** `localtools.test.ts` 先红

## ADDED Requirements

### Requirement: 协议说明不承诺做不到的事

协议说明里本地工具那段（`src/lib/instructions.ts`）SHALL 只描述工具**实际做得到的**行为：
`description` 与正文 MUST NOT 承诺「返回答复正文」这类该工具取不到的东西。
失败处置口径 SHALL 把**工具自己回的那些码**（含 `page-changed`）也覆盖到——原来只写了
「闸挡下 / 超时 / 页面不在」，其余码模型无从判断该不该重排。

#### Scenario: 描述与实现对拍

- **WHEN** 工具的返回形状变了（少了 `wait.reply` 那段）
- **THEN** 描述同步改，`instructions.test.ts` 的对拍先红

#### Scenario: 模型拿到失败码

- **WHEN** 工具回 `page-changed`（页面没有写作框之类）
- **THEN** 协议说明已写明这类码怎么处理（重排还是当没排过），模型不必猜
