# Spec Delta

## ADDED Requirements

### Requirement: 页面动作的候补控件只登记、不进名册

页面上**不在**名册里的控件 SHALL 按「建议动作名 / 定位（待真机确认）/ 返回形状」三列登记成
候补，状态记「只登记」，MUST NOT 写进 `entrypoints/content.ts` 的 `ACTION_ROSTER`——
**登记 ≠ 名册**：写了却没执行器，点下去只会回 `unknown-action`，是假实现。

定位口径同「控件定位优先设计系统语义锚」（`ds-*` / `role` / `aria-*`，不碰哈希 class）；
已实现动作另见 `protocol/fixtures/action.json` 与 `src/lib/page.ts`。

候补 SHALL 等真机确认后再升级，MUST NOT 凭文档里「待真机确认」的选择器直接上真机写执行器。
**用途未认出的控件 SHALL 记「待查」并写下线索，MUST NOT 硬编一个动作名。**

#### Scenario: 登记一个候选控件

- **WHEN** 认出页面上某个控件可做成动作，但还没实现
- **THEN** 按三列写进候补并标「只登记」，MUST NOT 进 `ACTION_ROSTER`

#### Scenario: 消息工具栏那四项

- **WHEN** 想给 assistant 消息的「复制 / 重试 / 点赞点踩 / 朗读」做动作
- **THEN** 登记 `message.copy` / `message.retry` / `message.react`（`params: { value: "up" | "down" }`）/
  `message.read`（唯一带 `aria-label`），四项都要「第几条消息」参数，定位待真机确认——
  都不进名册

#### Scenario: 代码块那两项

- **WHEN** 想给代码块的「复制 / 下载」做动作
- **THEN** 登记 `code.copy` / `code.download`，都要「第几个块」参数，定位待真机确认——都不进名册

#### Scenario: 附件上传

- **WHEN** 想把 `attach.add` 做成动作
- **THEN** 登记为候选（背后是 `input[type=file][multiple]`），**要文件数据、风险高**，
  先登记不实现

#### Scenario: 为什么这几项只是登记

- **WHEN** 问候补为什么没进 v1
- **THEN** 消息工具栏与代码块要索引参数、附件要文件数据，改动面与误伤面都大——理由记在候补里

#### Scenario: 用途没认出

- **WHEN** 认出控件位置但不知它是什么（真机样本：与「复制 / 重试 / 点赞」同一行的分享/更多、
  模型选择、会话页头右上两个小图标）
- **THEN** 记「待查」并写下线索，MUST NOT 编一个动作名

#### Scenario: 候补项要上真机

- **WHEN** 想把某个候补实现成动作
- **THEN** 先真机确认定位与用途，再按「页面动作四处对齐」四处一起落

## MODIFIED Requirements

### Requirement: 页面动作四处对齐

一件页面动作 SHALL 四处对齐：执行器 `src/lib/page.ts` → 名册 `entrypoints/content.ts` 的
`ACTION_ROSTER` → 契约样例 `protocol/fixtures/action.json` → 同名共置测试。

#### Scenario: 加一件动作

- **WHEN** 新增动作
- **THEN** 四处都在，且 fixture 与执行器同批改

#### Scenario: 控件还没实现

- **WHEN** 只是登记一个页面控件
- **THEN** 写进本能力「页面动作的候补控件只登记、不进名册」的候补，MUST NOT 进 `ACTION_ROSTER`
  （进了只会回 `unknown-action`，是假实现）
