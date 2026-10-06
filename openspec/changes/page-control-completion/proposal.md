## Why

Issue #30（页面控件补全）的真机爬取已完成（2026-10-06）。现有 `frontend` spec 里的「候补控件」全按「定位待真机确认」登记，且有若干项记「待查」（分享/搜索/收起边栏/模型选择）。真机证据已落地，需把候补的定位口径从文档推测升级为真机实测，结掉待查项，并明确哪些进 v1 名册、哪些只留登记。

## What Changes

- `frontend` spec 的候补 requirement（`页面动作的候补控件只登记、不进名册`）做 MODIFIED：
  - 消息工具栏 6 颗按钮：定位从「待真机确认」→ 真机实测口径（同形 6 颗、锚点 `aria-label="朗读"`、第几颗 DOM 序）
  - 代码块复制/下载：定位从「待真机确认」→ 真机实测口径（块内文字 `复制`/`下载`、结构 `md-code-block` → `ds-button--borderlessNeutral…`）
  - 页头分享、侧栏搜索/收起边栏：从「待查」→ 已识别，登记动作名与定位
  - 模型选择：从「待查」→ 记「当前 UI 未见」
  - 明确标注哪些进 v1（已有执行器的 `think.*`/`search.*`/`button.*`/`send.enter`/`chat.new`/`wait.*`/`messages.*`/`composer.*`/`tabs.list`/`page.state`）、哪些只留候补登记（消息工具栏、代码块、附件上传、页头分享、侧栏两项）
- **不改代码**、**不改 `site-dom` 锚点**、**不触发「改锚点补 fixture」规矩**——只改 spec 文字与候补表
- **Follow-up**：ADR-0018 落 spec requirement + 真机存证对拍测试，另开 change 落（本 change 只做 spec 文字升级）

## Capabilities

### New Capabilities

- (none)

### Modified Capabilities

- `frontend`: 候补控件的定位口径从「待真机确认」升级为真机实测口径；待查项结掉（分享/搜索/收起边栏→已识别，模型选择→未见）；明确 v1 名册边界

## Impact

- 仅改 `openspec/specs/frontend/spec.md` 的候补 requirement 与场景文字
- 不改 `entrypoints/content.ts`、`src/lib/page.ts`、`protocol/fixtures/action.json`、`site-dom` spec
- 不新增执行器、不改 `ACTION_ROSTER`
- 代码层面的实现（把消息工具栏/代码块/页头/侧栏真正写成动作）另开 issue（需先按 ADR-0018 补真机存证对拍测试）
