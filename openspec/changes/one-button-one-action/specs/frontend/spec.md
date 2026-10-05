# Spec Delta

## REMOVED Requirements

### Requirement: 同一元素多态按图标 `path` 判别

退役原因：站点的圆键两态**不是**我们名册里的两个单元——#15 的最小单元原则是**一个按钮只能
对应一个最小单元**，所以 `send.click` 与 `stop.click` 合并成 `button.click`（见
「一个按钮一个动作」）。合并后图标不再是命中判据，只在 `button.get` 里当状态报告。

### Requirement: 生成分两相，停止键只认停止相

退役原因：约束它的前提是「存在一个独立的 `stop.click` 动作」。合并后没有独立的停止动作，
思考期 spinner 归 `button.click` 管，其处置见「按钮的读写成对」与 `site-dom` 的
「圆键两态同元素」。

## MODIFIED Requirements

### Requirement: 动作 fail-safe

动作找不到认得的控件、或控件不可用时 SHALL 抛
`PageError(ACTION_ERROR_PAGE_CHANGED)`，MUST NOT 猜、MUST NOT 假装做过。**「元素在」不等于
「可用」**：带 `ds-button--disabled` 或没渲染出盒子都不算可用。控件**可用**时则点它——
命中判据不含意图，点下去是发送还是停止由页面决定。

#### Scenario: 控件不在

- **WHEN** 认可的锚点一个都没命中
- **THEN** 回 `page-changed`（fail-safe，绝不误点发送）

#### Scenario: 控件不可用

- **WHEN** 圆键在但带 `ds-button--disabled`（空输入框时它是禁用态），或没有渲染出盒子
- **THEN** `button.click` 回 `page-changed`，不点

#### Scenario: 控件可用就点（不管它是发送还是停止）

- **WHEN** `button.click` 到达而圆键此刻是停止方块（生成中）
- **THEN** 点它——这就是停止，页面自己的语义；`button.click` 不判意图

### Requirement: 控件定位优先设计系统语义锚

页面动作的控件定位 SHALL 优先站点设计系统的 `ds-*` class 与语义属性（`role` / `aria-*` /
`data-*` key）；MUST NOT 用哈希 class。图标 `path` MUST NOT 作定位判据——它只作**状态
报告**（`button.get`）。站点 DOM 锚点的完整契约见 `site-dom` 能力。

#### Scenario: 定位控件

- **WHEN** 要找一个按钮
- **THEN** 用 `ds-button` / `role` / `aria-label`，不用 `_52c986b` 这类哈希，也不用图标
  `path` 来决定「找不找得到」

#### Scenario: 图标只用于报告

- **WHEN** 想知道那个圆键此刻承载什么意图
- **THEN** 由 `button.get` 读图标并报 `pressed`，不把它塞进定位判据

## ADDED Requirements

### Requirement: 一个按钮一个动作

名册 SHALL 按**控件**划分最小单元，一个按钮只能对应一个动作；MUST NOT 因站点把多个意图
压进同一个 DOM 元素而把它拆成多个动作（那是站点形状，不是我们的契约）。同一元素上按图标
区分意图的做法 SHALL 淘汰——图标区分的是意图，不是控件身份。

#### Scenario: 站点把两个意图压进一个键

- **WHEN** 同一个圆键在生成期变成停止键（class 一个不换、只有图标不同）
- **THEN** 名册里只有**一个**动作指向它（`button.click`），不是两个各认一种图标的动作

#### Scenario: 读动作与写动作成对

- **WHEN** 一个控件的状态需要先读
- **THEN** 读独立成一条读动作（`button.get`），照 `think.get`/`think.set` 的成对形状

### Requirement: 按钮的读写成对

`button.get` SHALL 只读不点，返回 `{ pressed: "send" | "stop" | "unknown" }`——图标认不出
回 `unknown`（**成功**返回，键在但不知是什么是有效事实），圆键整个不在才回 `page-changed`。
`button.click` SHALL 只点不读意图，返回 `{}`；其命中判据是「圆键在 + 可用」，MUST NOT 含
图标。`button.get` 不受任何闸；`button.click` SHALL 同时进「代你发言」闸与「退避」闸，
MUST NOT 按 `pressed` 动态放行。

#### Scenario: 先读后写

- **WHEN** agent 想停一次生成
- **THEN** `button.get` 读到 `stop` 再 `button.click`；`click` 自己不判断

#### Scenario: 图标认不出

- **WHEN** 圆键在但图标既非箭头也非方块（站点换图标 / 思考期环形）
- **THEN** `button.get` 回 `pressed: "unknown"`；`button.click` 的判据不受影响，照可用性决定

#### Scenario: 闸关着点不了按钮

- **WHEN** 「代你发言」闸关着而 agent 发 `button.click`
- **THEN** 回 `disabled`，哪怕此刻圆键其实是停止键——点击结果在闸关着时判不出，保守即正确

#### Scenario: 退避期同样点不了

- **WHEN** 账号在退避期而 agent 发 `button.click`
- **THEN** 回 `disabled`（它总是改页面状态）；`button.get` 不受影响，照样读得出处境
