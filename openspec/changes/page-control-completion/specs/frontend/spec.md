## MODIFIED Requirements

### Requirement: 页面动作的候补控件只登记、不进名册

页面上**不在**名册里的控件 SHALL 按「建议动作名 / 定位（真机实测）/ 返回形状」三列登记成
候补，状态记「只登记」，MUST NOT 写进 `entrypoints/content.ts` 的 `ACTION_ROSTER`——
**登记 ≠ 名册**：写了却没执行器，点下去只会回 `unknown-action`，是假实现。

定位口径同「控件定位优先设计系统语义锚」（`ds-*` / `role` / `aria-*`，不碰哈希 class）；
已实现动作另见 `protocol/fixtures/action.json` 与 `src/lib/page.ts`。

候补 SHALL 等真机确认后再升级，MUST NOT 凭文档里「待真机确认」的选择器直接上真机写执行器。
**用途未认出的控件 SHALL 记「待查」并写下线索，MUST NOT 硬编一个动作名。**
真机证据以 2026-10-06 爬取为准（`scripts/page-action.py`，会话 `976c5618`）。

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

#### Scenario: 模型选择（真机 2026-10-06 实测）

- **WHEN** 找模型选择控件
- **THEN** 记「当前 UI 未见」：全仓 class 含 `model` 0 命中、真机探针 `ax` 与悬停 tooltip 均无模型选择相关控件，**不编动作名**

#### Scenario: 为什么这些项只是登记（v1 名册边界）

- **WHEN** 问候补为什么没进 v1
- **THEN** v1 名册（`ACTION_ROSTER`）已含：`think.get/set`、`search.get/set`、`button.get/click`、`send.enter`、`chat.new`、`wait.fence/reply`、`messages.list/last`、`composer.read/type/clear`、`tabs.list`、`page.state`——这些都有执行器、四处对齐、测试过。
  候补项（消息工具栏六项、代码块两项、附件上传、页头分享、侧栏两项）**需要索引参数 / 文件数据 / 改动面大**，改动与误伤面都大——理由记在候补里，**等真机存证对拍（ADR-0018）落地后再考虑实现**。

#### Scenario: 候补项要上真机

- **WHEN** 想把某个候补实现成动作
- **THEN** 先真机确认定位与用途，再按「页面动作四处对齐」四处一起落；且须满足 ADR-0018 的真机存证对拍要求
