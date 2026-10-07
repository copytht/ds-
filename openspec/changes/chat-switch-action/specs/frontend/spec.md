## ADDED Requirements

### Requirement: 会话切换与会话列表

名册 SHALL 含只读动作 `chats.list` 与写动作 `chat.switch`，两者按 `href` 里的会话 id 对应侧栏会话条目
（`a[href^="/a/chat/s/"]`，id 为 `href` 末段）。定位 MUST NOT 用哈希 class；标题取条目的 `textContent`
（去前后空白）。

- `chats.list` SHALL 只读，返回 `{ chats: [{ id, title, current }] }`，按侧栏自上而下的顺序；
  `current` 为该条 `href` 等于当前 `location.pathname`。不受任何闸。
- `chat.switch` SHALL 接受 `{ id }` 或 `{ title }`——**恰好其一且为非空字符串**，否则回 `unknown-action`。
  命中 0 条回 `page-changed`；`title` 命中多于 1 条回 `unknown-action`（歧义是参数的问题，
  调用方改用 `id`）；命中恰好 1 条就点它，返回 `{}`。`chat.switch` SHALL 进「退避」闸，MUST NOT
  进「代你发言」闸。

#### Scenario: 列出会话

- **WHEN** 侧栏有若干会话条目而 agent 发 `chats.list`
- **THEN** 回 `{ chats: [...] }`，每条带 `id`（href 末段）、`title`、`current`；同名会话各占一条，靠 `id` 区分

#### Scenario: 侧栏上没有会话条目

- **WHEN** `chats.list` 到达而页面上一条 `a[href^="/a/chat/s/"]` 都没有
- **THEN** 回 `{ chats: [] }`，不算错（与 `messages.list` 对新对话的口径一致）

#### Scenario: 按 id 切换

- **WHEN** agent 发 `chat.switch`，`params` 为 `{ id: "<uuid>" }` 而侧栏有 `href` 末段等于它的条目
- **THEN** 点那一条，回 `{}`；调用方用 `page.state` 的 `url` 核实落点

#### Scenario: 按标题切换且标题唯一

- **WHEN** `params` 为 `{ title: "..." }` 而侧栏恰好一条条目标题与它相等
- **THEN** 点那一条，回 `{}`

#### Scenario: 标题重名

- **WHEN** `params` 为 `{ title: "..." }` 而侧栏有多于一条同名条目
- **THEN** 回 `unknown-action`，**不点任何一条**（宁可拒绝也不替人选一个）

#### Scenario: 找不到那一条

- **WHEN** `params` 里的 `id` 或 `title` 在侧栏上命中 0 条
- **THEN** 回 `page-changed`，不点

#### Scenario: 参数形状不对

- **WHEN** `id` 与 `title` 都没给、都给了、或不是非空字符串
- **THEN** 回 `unknown-action`，不点

#### Scenario: 切到当前会话

- **WHEN** 命中的那一条就是当前所在会话
- **THEN** 不点，回 `{}`（幂等，同 `think.set` 已在目标态就不动）

#### Scenario: 退避期点不了

- **WHEN** 账号在退避期而 agent 发 `chat.switch`
- **THEN** 回 `backing-off`；`chats.list` 不受影响，照样读得出

#### Scenario: 总开关关着或「代你发言」闸关着

- **WHEN** 总开关关着而 agent 发 `chat.switch`
- **THEN** 回 `disabled`；而「代你发言」闸关着 MUST NOT 影响 `chat.switch`（它不动写作框）

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
2026-10-07 实测，**已实现并转入 v1 名册**（见「会话切换与会话列表」）。

#### Scenario: 登记一个候选控件

- **WHEN** 认出页面上某个控件可做成动作，但还没实现
- **THEN** 按三列写进候补并标「只登记」，MUST NOT 进 `ACTION_ROSTER`

#### Scenario: 消息工具栏六项（真机 2026-10-06 实测）

- **WHEN** 想给 assistant 消息的工具栏 6 颗按钮做动作
- **THEN** 登记：
  - `message.copy`（复制，第 1 颗）
  - `message.retry`（重新生成，第 2 颗，带 `aria-disabled=false` 表示可用态）
  - `message.like`（喜欢，第 3 颗）
  - `message.dislike`（不喜欢，第 4 颗）
  - `message.read`（朗读，第 5 颗，**唯一带 `aria-label="朗读"`**，作语义锚）
  - `message.share`（分享，第 6 颗）
    六颗按钮**逐字节同形**：`div[role=button].ds-button.ds-button--iconLabelTertiary.ds-button--icon.ds-button--capsule.ds-button--xs.ds-button--icon-relative-l` + 同一哈希 `db183363`，`tabindex=0`，无文字、无 `title`、无 `data-*`；身份**仅靠 DOM 序**（以 `aria-label="朗读"` 为锚向前/向后数）与悬停 tooltip 识别。六项都要「第几条消息」参数，**只登记、不进名册**。

#### Scenario: 代码块那两项（真机 2026-10-06 实测）

- **WHEN** 想给代码块的「复制 / 下载」做动作
- **THEN** 登记 `code.copy` / `code.download`，都要「第几个块」参数。
  真机结构：`div.md-code-block.md-code-block-light` → `md-code-block-banner-wrap`（语言标签）+ `pre` + 2 个 `svg`；两颗按钮在 `md-code-block-banner-wrap` 内，`[role=button].ds-button.ds-button--borderlessNeutral.ds-button--borderless.ds-button--capsule.ds-button--xs.ds-button--icon-relative-m.ds-button--min-width`，`textContent` 分别为「复制」「下载」——**靠块内文字定位**。两项**只登记、不进名册**。

#### Scenario: 附件上传

- **WHEN** 想把 `attach.add` 做成动作
- **THEN** 登记为候选（背后是 `input[type=file][multiple]`），**要文件数据、风险高**，先登记不实现

#### Scenario: 页头分享（真机 2026-10-06 实测）

- **WHEN** 想给会话页头右上唯一按钮做动作
- **THEN** 登记 `header.share`（分享），真机位置 (1421,12)，无需额外参数，**只登记、不进名册**

#### Scenario: 侧栏搜索与收起边栏（真机 2026-10-06 实测）

- **WHEN** 想给侧栏顶部两颗按钮做动作
- **THEN** 登记：
  - `sidebar.search`（搜索 ⌘K，位置 (198,25)）
  - `sidebar.collapse`（收起边栏，位置 (232,25)）
    真机均为 `ds-button` 系、有文字标签，**只登记、不进名册**

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
- **THEN** v1 名册（`ACTION_ROSTER`）已含：`think.get/set`、`search.get/set`、`button.get/click`、`send.enter`、`chat.new`、`chat.switch`、`chats.list`、`wait.fence/reply`、`messages.list/last`、`composer.read/type/clear`、`tabs.list`、`page.state`——这些都有执行器、四处对齐、测试过。
  候补项（消息工具栏六项、代码块两项、附件上传、页头分享、侧栏两项）
  **需要索引参数 / 文件数据 / 改动面大**，改动与误伤面都大——理由记在候补里，
  **等真机存证对拍（ADR-0018）落地后再考虑实现**。

#### Scenario: 候补项要上真机

- **WHEN** 想把某个候补实现成动作
- **THEN** 先真机确认定位与用途，再按「页面动作四处对齐」四处一起落；且须满足 ADR-0018 的真机存证对拍要求
