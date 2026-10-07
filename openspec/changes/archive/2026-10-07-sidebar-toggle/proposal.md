## Why

侧栏的开关也是控件：agent 要能自己收起 / 展开侧栏（它还是验证「收起态下各动作是否照常」的前提——#76 就是因为探针
不许点站点、而 `sidebar.collapse` 只是候补，才得靠人手动收起来验）。

2026-10-07 真机在**两种状态**下读了顶栏（用户手动收起后）：

- 展开：2 颗无字图标键（搜索、**侧栏开关**）+ 带文字的「开启新对话」条目；
- 收起：3 颗无字图标键（**侧栏开关**、搜索、新对话），「开启新对话」条目仍在 DOM 但不可见。
- **侧栏开关两态是同一个控件**：图标 `path` 不变，只是位置从「2 颗里第 2」变成「3 颗里第 1」。

按「一个按钮一个动作」，它不该拆成 collapse / expand 两个动作，而该是**读写成对**（照 `think.get/set`）。

## What Changes

- 新增只读动作 **`sidebar.get`**：返回 `{ collapsed: boolean }`。
- 新增写动作 **`sidebar.set`**：`{ collapsed: boolean }`；已在目标态就不点（幂等），点完**等稳定**再回达成态
  （复用 #81 的做法，站点异步生效）。进「退避」闸，不进「代你发言」闸。
- 定位以带文字的**「开启新对话」条目**为锚：状态 = 该条目有没有布局盒；开关键 = 侧栏里「无字、不在会话条目内的图标键」
  那一组里的第 2 颗（展开，共 2 颗）或第 1 颗（收起，共 3 颗）；数量或状态对不上一律 `page-changed`、不点。
- 补存证（ADR-0018）：展开 / 收起两态的顶栏容器与开关键。
- 四处对齐：执行器 / `ACTION_ROSTER` / `action.json` / 共置测试（原件取自存证）。
- `frontend` spec：新增「侧栏开关」requirement；候补 requirement MODIFIED（`sidebar.collapse` 转为 `sidebar.get/set`，
  `sidebar.search` 仍留候补）。
- **不做**：`sidebar.search`（仍无可靠锚、点开会弹搜索面板，另议）；侧栏里「新对话」那颗（已有 `chat.new`）。

## Capabilities

### New Capabilities

- (none)

### Modified Capabilities

- `frontend`: 新增「侧栏开关」requirement；候补 requirement 里 `sidebar.collapse` 转为 `sidebar.get/set`

## Impact

- `src/lib/page.ts`（`readSidebar` / `setSidebar`；抽出与开关共用的「点完等稳定」小函数）与 `page.test.ts`
- `entrypoints/content.ts`（`ACTION_ROSTER` 加两条）
- `src/lib/action.ts`（`BACKOFF_GATED_ACTIONS` 加 `sidebar.set`）及测试
- `protocol/fixtures/action.json`、`protocol/evidence/controls.json`
- `openspec/specs/frontend/spec.md`（经归档同步）
- 不改失败码册子、不改 `site-dom` 锚点
- 前置：真机点验要在 ds-browser 里把侧栏来回切（探针自己点，不再要人手动）
