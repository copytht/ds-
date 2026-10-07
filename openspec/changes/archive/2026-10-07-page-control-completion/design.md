## Context

Issue #30（页面控件补全）要求把页面上其余按钮标成动作。现有 `frontend` spec 的「页面动作的候补控件只登记、不进名册」 requirement 里，所有候补项的定位都写「待真机确认」，且有若干项记「待查」（分享/搜索/收起边栏/模型选择）。

2026-10-06 已完成真机爬取（`scripts/page-action.py --debug`，会话 `976c5618`），取得了全部候补控件的真机实测定位口径。本 change 的任务是**仅修改 spec 文字**，把候补表从「待真机确认」升级为真机实测口径，结掉待查项，明确 v1 名册边界。

**关键约束**：

- 不改代码（`entrypoints/content.ts`、`src/lib/page.ts`、`protocol/fixtures/action.json` 均不动）
- 不改 `site-dom` 能力的 DOM 锚点
- 不触发「改锚点补 fixture」规矩（`frontend` spec 的 `真机 DOM 落成回归用例` 仅管已实现动作）
- ADR-0018（制作最小单元必须原样保留按钮的代码与图片）已在 `#63` 合并，要求真机存证对拍；本 change **不落实现**，只做 spec 文字升级，ADR-0018 的落实（spec requirement + 探针对账子命令 + 对拍测试）另开 change

## Goals / Non-Goals

**Goals:**

- `frontend` spec 候补 requirement 全量升级：定位口径从「待真机确认」→ 真机实测
- 待查项结掉：页头分享、侧栏搜索/收起边栏→已识别并登记；模型选择→记「当前 UI 未见」
- 明确 v1 名册边界（已实现 15 条动作进名册，候补项全留候补）

**Non-Goals:**

- 不新增执行器、不改 `ACTION_ROSTER`
- 不改 `protocol/fixtures/action.json` 契约样例
- 不写回归测试（那是实现阶段配合 ADR-0018 做的事）
- 不处理消息工具栏 6 颗同形按钮的「如何在执行器里按 DOM 序点第 N 颗」——那是实现细节

## Decisions

### 1. 只改 spec 文字，不动代码与契约

**Rationale**：候补的定位与待查项本质是「文档层面的知识更新」。真机证据已在手（会话 `976c5618` 的爬取记录），把它写进 spec 让后续实现者有据可依。代码层面的实现（把这些候补真正写成动作、进名册、四处对齐）涉及：

- 消息工具栏：同形 6 颗按钮需按 DOM 序 + `aria-label="朗读"` 锚点定位
- 代码块：块内文字定位 + `md-code-block-banner-wrap` 结构
- 附件上传：涉及 `input[type=file][multiple]` 与文件数据传递
- 以上都需要 ADR-0018 的真机存证对拍先落地

把「写 spec」与「写代码」分两个 change，符合 OpenSpec「spec 先行」原则，也避免一次 PR 做太多事。

### 2. 候补登记的三列格式保持不变：建议动作名 / 定位（真机实测）/ 返回形状

**Rationale**：现有格式已被工具链（人工阅读、后续实现参考）认可。只把「定位」列的内容从「待真机确认」替换为具体的真机实测选择器/策略，「返回形状」按现有动作类型推断（读类返回 `{...}`、写类返回 `{}`）。

### 3. 真机实测定位口径的具体写法

- **消息工具栏六项**：以 `aria-label="朗读"` 为语义锚，向前/向后数 DOM 序（第 1~6 颗）。选择器示例：`div[role=button].ds-button--iconLabelTertiary...:nth-of-type(N)` 或在工具栏容器（`.ds-flex` 含 `aria-label="朗读"` 的那排）内按顺序取第 N 个 `[role=button]`。
- **代码块复制/下载**：在 `div.md-code-block` 内找 `md-code-block-banner-wrap` 下的两个 `[role=button]`，按 `textContent === "复制"` / `"下载"` 区分。
- **页头分享**：页头区唯一 `ds-button`，或 `header ds-button`。
- **侧栏搜索/收起**：侧栏顶部两个 `ds-button`，按文字「搜索 ⌘K」/「收起边栏」区分。

### 4. v1 名册边界显式写入候补 requirement 的「为什么只是登记」场景

**Rationale**：现有 spec 只在「为什么这几项只是登记」里泛泛说「改动面大」。本次把已实现的 15 条名册动作列出来（`think.*`/`search.*`/`button.*`/`send.enter`/`chat.new`/`wait.*`/`messages.*`/`composer.*`/`tabs.list`/`page.state`），与候补项对比，让边界一目了然。

## Risks / Trade-offs

| Risk                                                   | Mitigation                                                                                                                                                                                                            |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spec 里写了真机选择器，站点改版后选择器失效            | 选择器只用 `ds-*`/`role`/`aria-*` 语义锚，不碰哈希 class；真机存证对拍（ADR-0018）落地后，站点改版会在 CI 红、在探针对账时报警                                                                                        |
| 消息工具栏 6 颗同形按钮的 DOM 序在虚拟列表滚动时可能变 | 真机爬取已确认：工具栏在 `div.ds-flex` 容器内、直接子元素为 6 个 `[role=button]`，不随虚拟列表滚动而变序（虚拟列表是消息列表 `.ds-virtual-list--printable`，工具栏在每条消息内固定）。实现时在该容器内按 index 取即可 |
| 代码块结构若站点改版（如 `banner-wrap` 换名）会失效    | 同理：选 `ds-*` 语义锚 + 块内文字，不依赖易变的 wrapper class；ADR-0018 存证对拍会捕获结构变化                                                                                                                        |
| 模型选择记「未见」但未来站点加上了                     | 记「当前 UI 未见」而非「永远没有」；未来真机发现再升级为候补，流程不变                                                                                                                                                |

## Open Questions

- **ADR-0018 的 spec requirement 何时落？** 按 ADR-0018 Consequences 的 Follow-up：「随 #30 的 change 一起」。但本 change 只改 spec 文字、不加测试。建议：另开一个 change（如 `frontend-spec-adr0018-followup`）专门落 ADR-0018 的两样（spec requirement + 探针真机对账子命令 + 对拍测试），然后才轮到候补项的真正实现。
- **消息工具栏的「第几条消息」参数怎么传？** 现有 `messages.list` 返回的消息数组有索引，执行器可按索引定位到那条消息的工具栏容器。具体实现留待实现阶段。
- **附件上传的 `params` 形状？** 背后是 `input[type=file][multiple]`，涉及文件读取、base64 或 blob 传递、权限。风险高，暂不定形状，候补只记「要文件数据、风险高」。
