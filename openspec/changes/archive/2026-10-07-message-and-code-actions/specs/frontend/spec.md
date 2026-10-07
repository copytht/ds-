## ADDED Requirements

### Requirement: 消息工具栏与代码块动作

名册 SHALL 含 8 个写动作：`message.copy` / `message.retry` / `message.like` / `message.dislike` /
`message.read` / `message.share`，与 `code.copy` / `code.download`。参数都是 `{ index }`，成功回 `{}`，
点完 MUST NOT 回读（站点异步生效）。

**`index`**：整数；从**当前挂载的**目标集合里数，0 起，负数从末尾数（`-1` = 最新一个）。
`message.*` 的集合是挂载的消息行，`code.*` 的集合是对话列表里挂载的 `div.md-code-block`（文档序）。
它 MUST NOT 被当成 `messages.list` 的下标——后者靠滚动把整段对话扫一遍，工具栏只存在于挂载的行里。

**定位**（MUST NOT 用哈希 class、图标 `path` 不作判据）：

- 消息工具栏：该行内（真机它在 `.ds-message` 之外，但这只是描述、不作判据）**恰好有 6 颗直接子 `[role=button]` 且第 5 颗带
  `aria-label="朗读"` 的那个容器**；动作名对应第几颗：`copy`=1、`retry`=2、`like`=3、`dislike`=4、`read`=5、`share`=6。
- 代码块：块内 `[role=button]` 的 `textContent`（去前后空白）为「复制」/「下载」。

结构不符（容器里不是恰好 6 颗、`朗读` 不在第 5 颗、块里找不到那个文字）一律当「控件不在」，MUST NOT 猜。

**闸**：8 个动作 SHALL 进「退避」闸；`message.retry` SHALL 另进「代你发言」闸（它让账号重新生成一条回答，
等同发送）；其余 7 个 MUST NOT 进「代你发言」闸（不动写作框、不发言）。

#### Scenario: 点最新一条回答的某颗按钮

- **WHEN** agent 发 `message.copy`，`params` 为 `{ index: -1 }` 而最后一个挂载的消息行是 assistant 消息
- **THEN** 点该行工具栏的第 1 颗，回 `{}`

#### Scenario: 按位置取行

- **WHEN** `index` 为 `0` 起的非负整数且小于挂载行数
- **THEN** 取第 `index` 个挂载的消息行；`-1` 取最后一行，`-2` 取倒数第二行

#### Scenario: 点到用户消息

- **WHEN** `index` 指向的是用户消息行（它的工具栏只有 2 颗）
- **THEN** 回 `page-changed`，不点

#### Scenario: 工具栏结构不符

- **WHEN** 该行里装着 `[role=button]` 的容器不是恰好 6 颗，或带 `aria-label="朗读"` 的那颗不在第 5 位
- **THEN** 回 `page-changed`，不点——宁可不点也不凭序号猜

#### Scenario: 按钮不可用

- **WHEN** 目标那颗带 `aria-disabled="true"`
- **THEN** 回 `page-changed`，不点（「元素在」不等于「可用」）

#### Scenario: index 越界或不是整数

- **WHEN** `index` 超出挂载集合（含空集合），回 `page-changed`；`index` 缺失或不是整数，回 `unknown-action`
- **THEN** 都不点

#### Scenario: 点代码块的复制或下载

- **WHEN** agent 发 `code.copy` 或 `code.download`，`index` 命中一个挂载的代码块，块内有 `textContent` 为「复制」/「下载」的按钮
- **THEN** 点那一颗，回 `{}`

#### Scenario: 代码块里找不到那个文字

- **WHEN** 命中的代码块里没有文字为「复制」/「下载」的 `[role=button]`
- **THEN** 回 `page-changed`，不点

#### Scenario: 退避期点不了

- **WHEN** 账号在退避期而 agent 发这 8 个动作中的任何一个
- **THEN** 回 `backing-off`，不点

#### Scenario: 重新生成要「代你发言」闸

- **WHEN** 「代你发言」闸关着而 agent 发 `message.retry`
- **THEN** 回 `disabled`；而发 `message.copy` 等其余 7 个动作 MUST NOT 被这个闸拦下

#### Scenario: 存证先行

- **WHEN** 新增这 8 个动作的执行器
- **THEN** 6 颗工具栏按钮、工具栏容器、用户消息的 2 颗工具栏（反例）都已按 ADR-0018 入档
  `protocol/evidence/controls.json`，回归用例原件取自存证、不手抄

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
- **THEN** 登记：
  - `sidebar.search`（搜索 ⌘K）
  - `sidebar.collapse`（收起边栏）
    2026-10-07 真机更正：这两颗**不是**「有文字标签」——`textContent` 为空、无 `aria-label`、无 `title`，
    同一容器里的两颗兄弟（`ds-button--iconLabelTertiary … ds-button--m`，末尾哈希不同），**身份只靠顺序**
    （名字来自 2026-10-06 悬停 tooltip）。没有可靠锚点之前**只登记、不进名册**。

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
- **THEN** v1 名册（`ACTION_ROSTER`）已含：`think.get/set`、`search.get/set`、`button.get/click`、`send.enter`、`chat.new`、`chat.switch`、`chats.list`、`message.copy/retry/like/dislike/read/share`、`code.copy/download`、`wait.fence/reply`、`messages.list/last`、`composer.read/type/clear`、`tabs.list`、`page.state`——这些都有执行器、四处对齐、测试过。
  候补项（附件上传、页头分享、侧栏两项）
  **需要文件数据 / 缺可靠语义锚 / 改动面大**，改动与误伤面都大——理由记在候补里，
  **等真机存证对拍（ADR-0018）落地后再考虑实现**。

#### Scenario: 候补项要上真机

- **WHEN** 想把某个候补实现成动作
- **THEN** 先真机确认定位与用途，再按「页面动作四处对齐」四处一起落；且须满足 ADR-0018 的真机存证对拍要求
