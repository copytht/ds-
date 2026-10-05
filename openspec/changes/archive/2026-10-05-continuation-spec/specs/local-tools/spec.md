# Spec Delta

## MODIFIED Requirements

### Requirement: `send.page` 的契约

`send.page` SHALL 收 `question`（非空字符串，必填）与 `seconds`（可选，缺省 25、钳 1..25，
与 `wait.ts` 同口径）；执行 SHALL 依次为 `composer.type` → `send.enter` → `wait.fence` →
`wait.reply`，全走 `runAction`（总开关 / 替你发言 / 退避三道闸照拦）。

> **⚠ 现状与真实链路不符（#47，待人拍板修法）——补这条 spec 的 change 没有修它**，
> `send.page` 现在仍每次以 `page-changed` 收场、消息仍已发出。别把「spec 齐了」当成
> 「问题解决了」。
> 根因：ADR-0014 之后回灌进页面的正文只有两行短标记，
> 所以 `wait.reply` 等到的是那条短标记（首行锚 `agent:`，**匹配成功**），而本条要求把
> `wait.reply` 的 `{text}` 经 `parseReplyPayload` 解回载荷正文——解不开就回 `page-changed`。
> 于是 `send.page` **每次都以 `page-changed` 收场，而前两步已把消息真发出去了**，模型合理地
> 重试 → 同一个问题被重复发进对话。
>
> 修法三条（**需人拍板**，本 spec 不先填新口径）：
> A. 让它等回复的**正文**（要另开读取手段）；
> B. 拆成「发问题」与「读答复」两个工具；
> C. 撤掉 `send.page`——ADR-0014 之后「发问题 → 等答复」已由 `send` 围栏那条主路覆盖。
>
> 拍板后本条与 `protocol/fixtures/action.json`、`localtools.test.ts` MUST 同步反映真实链路
> （那两处现在仍写旧的长 TOON 形状：`action.json:386`、`localtools.test.ts:24`）。

#### Scenario: 成功

- **WHEN** 四步依次成
- **THEN** 把 `wait.reply` 的 `{text}` 经 `parseReplyPayload` 解回正文，`okPayload(正文)` 回灌

#### Scenario: 失败

- **WHEN** 任一步没成
- **THEN** 回 `errorPayload(码)`，码全取现成册子（不新增），且不进对话流（`isInjectableReply` 挡）

#### Scenario: 缩写口径

- **WHEN** `seconds` 缺省或越界
- **THEN** 缺省 25、钳 1..25，与 `wait.ts` 同一份 `params.timeout` 口径
