## ADDED Requirements

### Requirement: 侧栏开关

名册 SHALL 含只读动作 `sidebar.get` 与写动作 `sidebar.set`，指向**同一个控件**——侧栏开关键
（展开与收起两态图标不变，只是位置变）。

- `sidebar.get` SHALL 只读，返回 `{ collapsed: boolean }`；不受任何闸。
- `sidebar.set` SHALL 接受 `{ collapsed: boolean }`（非布尔回 `unknown-action`）；已在目标态就不点（幂等）；
  点完 SHALL **等稳定**再回达成态（轮询状态到目标，上限与「两个小开关」同口径），MUST NOT 点完立刻读。
  SHALL 进「退避」闸，MUST NOT 进「代你发言」闸。

**定位**（MUST NOT 用哈希 class、图标 `path` 不作判据、屏幕坐标不作判据）：

- 锚：`[tabindex="0"]` 里 `textContent` 去空白后为「开启新对话」的条目（与 `chat.new` 同一个锚）。
  文字是本地化的，认不出当控件不在。
- 状态：该条目**没有布局盒**（`getClientRects()` 为空）= 收起；有 = 展开。
- 开关键：取该锚的最近祖先里「无字（`textContent` 为空）、带 `ds-button--icon`、不在会话条目 `a[href^="/a/chat/s/"]` 内、
  有布局盒」的图标键（文档序），**以其中第一颗的父元素为顶栏组**，只数该父元素的**直接子**里满足同样条件的图标键
  （别处的图标键——如会话列表里分组标题的折叠小键——不参与）；**展开态必须恰好 2 颗、开关键是第 2 颗；收起态必须恰好
  3 颗、开关键是第 1 颗**。数量与状态对不上、找不到锚，一律当控件不在。

#### Scenario: 读侧栏状态

- **WHEN** agent 发 `sidebar.get`
- **THEN** 回 `{ collapsed: false }`（展开）或 `{ collapsed: true }`（收起），不点任何东西

#### Scenario: 收起侧栏

- **WHEN** `sidebar.set` 收到 `{ collapsed: true }` 而侧栏是展开的
- **THEN** 点展开态 2 颗里的第 2 颗，等稳定后回 `{ collapsed: true }`

#### Scenario: 展开侧栏

- **WHEN** `sidebar.set` 收到 `{ collapsed: false }` 而侧栏是收起的
- **THEN** 点收起态 3 颗里的第 1 颗，等稳定后回 `{ collapsed: false }`

#### Scenario: 已在目标态

- **WHEN** `sidebar.set` 的目标态就是当前态
- **THEN** 不点、不轮询，立即回当前态

#### Scenario: 站点异步生效

- **WHEN** 点过之后侧栏要过一小会儿（上限内）才变到目标态
- **THEN** 等到变好再回达成态，MUST NOT 点完那一刻就读出旧值

#### Scenario: 站点拒了这一点

- **WHEN** 点过之后状态一直没变，直到上限
- **THEN** 回未变的状态（达成态），MUST NOT 回目标态

#### Scenario: 顶栏结构对不上

- **WHEN** 展开态里顶栏组的图标键不是恰好 2 颗，或收起态不是恰好 3 颗，或找不到「开启新对话」锚
- **THEN** 回 `page-changed`，不点——宁可停也不点到搜索或新对话

#### Scenario: 参数形状不对

- **WHEN** `collapsed` 缺失或不是布尔
- **THEN** 回 `unknown-action`，不点

#### Scenario: 退避期点不了

- **WHEN** 账号在退避期而 agent 发 `sidebar.set`
- **THEN** 回 `backing-off`；`sidebar.get` 不受影响

#### Scenario: 存证先行

- **WHEN** 新增这两个动作的执行器
- **THEN** 展开 / 收起两态的顶栏容器与开关键都已按 ADR-0018 入档 `protocol/evidence/controls.json`，回归用例读存证、不手抄

## MODIFIED Requirements

### Requirement: 页面动作的候补控件只登记、不进名册

页面上**不在**名册里的控件 SHALL 按「建议动作名 / 定位（真机实测）/ 返回形状」三列登记成
候补，状态记「只登记」，MUST NOT 写进 `entrypoints/content.ts` 的 `ACTION_ROSTER`——
**登记 ≠ 名册**：写了却没执行器，点下去只会回 `unknown-action`，是假实现。

定位口径同「控件定位优先设计系统语义锚」（`ds-*` / `role` / `aria-*`，不碰哈希 class）；
已实现动作另见 `protocol/fixtures/action.json` 与 `src/lib/page.ts`。

候补 SHALL 等真机确认后再升级，MUST NOT 凭文档里「待真机确认」的选择器直接上真机写执行器。
**用途未认出的控件 SHALL 记「待查」并写下线索，MUST NOT 硬编一个动作名。**
真机证据以 2026-10-06 爬取为准（`scripts/page-action.py`，会话 `976c5618`）；`chat.switch` 一项为
2026-10-07 实测，**已实现并转入 v1 名册**（见「会话切换与会话列表」）；消息工具栏六项与代码块两项同日转入
（见「消息工具栏与代码块动作」）。

#### Scenario: 登记一个候选控件

- **WHEN** 认出页面上某个控件可做成动作，但还没实现
- **THEN** 按三列写进候补并标「只登记」，MUST NOT 进 `ACTION_ROSTER`

#### Scenario: 消息工具栏六项（真机 2026-10-06 实测）

- **WHEN** 想给 assistant 消息的工具栏 6 颗按钮做动作
- **THEN** **已实现，不再是候补**：`message.copy` / `message.retry` / `message.like` / `message.dislike` /
  `message.read` / `message.share` 进了 v1 名册，契约见「消息工具栏与代码块动作」。
  当时的真机口径保留为依据：六颗按钮**逐字节同形**（`div[role=button].ds-button.ds-button--iconLabelTertiary.ds-button--icon.ds-button--capsule.ds-button--xs.ds-button--icon-relative-l` + 同一哈希 `db183363`，`tabindex=0`，无文字、无 `title`、无 `data-*`），
  身份**仅靠 DOM 序**（第 5 颗唯一带 `aria-label="朗读"`，作语义锚）与悬停 tooltip 识别。
  2026-10-07 补充：工具栏**在消息行内、`.ds-message` 之外**；用户消息的工具栏只有 2 颗（复制 + 编辑），不是这 6 颗。

#### Scenario: 代码块那两项（真机 2026-10-06 实测）

- **WHEN** 想给代码块的「复制 / 下载」做动作
- **THEN** **已实现，不再是候补**：`code.copy` / `code.download` 进了 v1 名册，契约见「消息工具栏与代码块动作」。
  真机结构：`div.md-code-block.md-code-block-light` → `md-code-block-banner-wrap`（语言标签）+ `pre` + 2 个 `svg`；两颗按钮在 `md-code-block-banner-wrap` 内，`[role=button].ds-button.ds-button--borderlessNeutral.ds-button--borderless.ds-button--capsule.ds-button--xs.ds-button--icon-relative-m.ds-button--min-width`，`textContent` 分别为「复制」「下载」——**靠块内文字定位**。

#### Scenario: 附件上传

- **WHEN** 想把 `attach.add` 做成动作
- **THEN** 登记为候选（背后是 `input[type=file][multiple]`），**要文件数据、风险高**，先登记不实现

#### Scenario: 页头分享（真机 2026-10-06 实测）

- **WHEN** 想给会话页头右上唯一按钮做动作
- **THEN** 登记 `header.share`（分享），无需额外参数，**只登记、不进名册**。
  2026-10-07 真机更正：这颗按钮**没有任何语义锚**——无文字、无 `aria-label`、无 `title`、无 `data-*`，
  祖先全是哈希 class，只有 `ds-button--iconLabelPrimary … ds-button--l` 一组设计系统 class；
  屏幕坐标随窗口宽度变（同一颗在 (1421,12) 与 (1151,12) 都见过），**不是**判据。没有可靠锚点之前不实现。

#### Scenario: 侧栏搜索与收起边栏（真机 2026-10-06 实测）

- **WHEN** 想给侧栏顶部两颗按钮做动作
- **THEN** `sidebar.search`（搜索 ⌘K）**只登记、不进名册**；`sidebar.collapse`（收起边栏）**已实现，不再是候补**——
  它与展开动作是同一个控件，做成读写成对的 `sidebar.get` / `sidebar.set`，契约见「侧栏开关」。
  2026-10-07 真机更正：这两颗**不是**「有文字标签」——`textContent` 为空、无 `aria-label`、无 `title`，
  同一容器里的兄弟（`ds-button--iconLabelTertiary … ds-button--m`），**身份只靠顺序**
  （名字来自 2026-10-06 悬停 tooltip）。`sidebar.search` 在展开态排第 1、收起态排第 2，
  没有可靠锚点之前不实现。

#### Scenario: 切换会话 `chat.switch`（真机 2026-10-07 实测）

- **WHEN** 想让 agent 自主切换到另一条会话继续
- **THEN** **已实现，不再是候补**：`chat.switch` 与配套的只读 `chats.list` 进了 v1 名册，契约见
  「会话切换与会话列表」。当时的真机口径保留为依据：侧栏条目 `a[href^="/a/chat/s/"]`，`href` 末段即
  会话 id；条目内嵌一颗 hover 才显形的「更多」按钮（与消息工具栏同形），所以存证 `sidebar.chat-row`
  是 `state-bound`。

#### Scenario: 模型选择（真机 2026-10-06 实测）

- **WHEN** 找模型选择控件
- **THEN** 记「当前 UI 未见」：全仓 class 含 `model` 0 命中、真机探针 `ax` 与悬停 tooltip 均无模型选择相关控件，**不编动作名**

#### Scenario: 为什么这些项只是登记（v1 名册边界）

- **WHEN** 问候补为什么没进 v1
- **THEN** v1 名册（`ACTION_ROSTER`）已含：`think.get/set`、`search.get/set`、`button.get/click`、`send.enter`、`chat.new`、`chat.switch`、`chats.list`、`message.copy/retry/like/dislike/read/share`、`code.copy/download`、`sidebar.get/set`、`wait.fence/reply`、`messages.list/last`、`composer.read/type/clear`、`tabs.list`、`page.state`——这些都有执行器、四处对齐、测试过。
  候补项（附件上传、页头分享、侧栏搜索）
  **需要文件数据 / 缺可靠语义锚 / 改动面大**，改动与误伤面都大——理由记在候补里，
  **等真机存证对拍（ADR-0018）落地后再考虑实现**。

#### Scenario: 候补项要上真机

- **WHEN** 想把某个候补实现成动作
- **THEN** 先真机确认定位与用途，再按「页面动作四处对齐」四处一起落；且须满足 ADR-0018 的真机存证对拍要求
