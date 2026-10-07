## Why

插件要能自主换会话——目前 agent 只能 `chat.new` 开新对话，回不到任何已有会话，也看不到有哪些会话。
`chat.switch` 已在 `chat-switch` change 里登记为候补（真机 2026-10-07 实测定位 + `sidebar.chat-row`
存证 + 对拍），ADR-0018 的前置闸已满足，现在可以把它做成真动作。

光有 `chat.switch` 不够用：真机侧栏有 5 条同名会话，agent 看不到 id 就没法唯一指定，所以要配一个
只读的 `chats.list`（读写成对，照 `think.get`/`think.set` 与 `messages.list` 的形状）。

## What Changes

- 新增页面动作 **`chats.list`**（只读）：返回侧栏现有会话 `{ chats: [{ id, title, current }] }`，不受任何闸。
- 新增页面动作 **`chat.switch`**（写）：参数 `{ id }` 或 `{ title }` 二选一；按 `href` 末段会话 id 或标题文本
  命中侧栏条目，点它。进「退避」闸（改页面状态），不进「代你发言」闸（不动写作框）。
- 失败码只用现成册子：参数形状不对 / 标题命中多条 → `unknown-action`；侧栏上找不到 → `page-changed`。
- 四处对齐：执行器 `src/lib/page.ts` → 名册 `entrypoints/content.ts` → 契约样例 `protocol/fixtures/action.json`
  → 同名共置测试（回归用例原件取自存证 `sidebar.chat-row`）。
- `frontend` spec：候补 requirement MODIFIED（`chat.switch` 转入 v1，名册边界场景更新）；新增 requirement 写清
  两个动作的契约。
- 真机点验：`chats.list` 读真实侧栏；`chat.switch` 切到另一条再用 `page.state` 的 `url` 核实落点，最后切回。
- **不做**：#66 B 的 11 项候补；切换后等消息列表渲染完成（调用方用 `wait.*` / `messages.list` 自己等）；
  按标题模糊匹配；跨标签页切换。

## Capabilities

### New Capabilities

- (none)

### Modified Capabilities

- `frontend`: 候补 requirement 里 `chat.switch` 转入 v1 名册并更新边界场景；新增「会话切换与会话列表」requirement

## Impact

- `src/lib/page.ts`（`listChats` / `switchChat`）、`src/lib/page.test.ts`
- `entrypoints/content.ts`（`ACTION_ROSTER` 加两条）
- `src/lib/action.ts`（`BACKOFF_GATED_ACTIONS` 加 `chat.switch`）及其测试
- `protocol/fixtures/action.json`（成功 / 标题重名 / 找不到三类样例）
- `openspec/specs/frontend/spec.md`（经归档同步）
- 不改 `site-dom` 锚点、不改失败码册子、不改 `protocol/evidence/controls.json`（存证已在）
- 前置：真机点验需要 ds-browser 已登录、侧栏至少两条会话
