## Why

#66 的 B：把已存证、已登记的候补控件做成真动作。消息工具栏（复制 / 重新生成 / 喜欢 / 不喜欢 / 朗读 / 分享）与
代码块（复制 / 下载）共 8 项，agent 目前一个都点不到——它能读到回答，却没法复制它、给它点赞或重新生成。

2026-10-07 真机再探发现：页头分享、侧栏搜索、侧栏收起这 3 项**没有任何语义锚**（无文字、无 `aria-label`、
无 `title`，祖先全是哈希 class），身份只靠「同一容器里的第几颗」。现有 spec 写的「侧栏两项有文字标签」与真机不符。
这 3 项本次**不做**，留候补，并更正 spec 里的错误描述。

## What Changes

- 新增 8 个页面动作：`message.copy` / `message.retry` / `message.like` / `message.dislike` / `message.read` /
  `message.share`（参数 `{index}`）；`code.copy` / `code.download`（参数 `{index}`）。写动作，返回 `{}`，点完不回读。
- `index` 是**当前挂载的行 / 代码块**里的位置（0 起，负数从末尾数，`-1` = 最新一个）——**不是**
  `messages.list` 的下标（后者靠滚动把整段对话扫一遍，工具栏只存在于挂载的行里）。
- 全部进「退避」闸；`message.retry` 另进「代你发言」闸（它让账号重新生成一条回答，等同发送）。
- 定位：工具栏 = 行内那个**恰好 6 颗 `[role=button]` 且第 5 颗带 `aria-label="朗读"`** 的容器，按 DOM 序取第 N 颗；
  不合就 `page-changed`、不点。代码块 = `div.md-code-block` 里 `textContent` 为「复制」/「下载」的按钮。
- 四处对齐：执行器 / `ACTION_ROSTER` / `action.json` / 共置测试；回归用例原件取自存证，**不手抄**。
- 真机补存证（ADR-0018）：6 颗工具栏按钮各一条 + 工具栏容器 + 用户消息的 2 颗工具栏（反例）。
- `frontend` spec：新增「消息工具栏与代码块动作」requirement；候补 requirement MODIFIED（8 项转入 v1；
  更正侧栏 / 页头两处与真机不符的描述）。
- **不做**：`header.share` / `sidebar.search` / `sidebar.collapse`（无语义锚，留候补）；`attach.add`；模型选择；
  真机点 `message.retry`（会真生成回答）。

## Capabilities

### New Capabilities

- (none)

### Modified Capabilities

- `frontend`: 新增「消息工具栏与代码块动作」requirement；候补 requirement 里 8 项转入 v1 名册，更正页头 / 侧栏描述

## Impact

- 新增 `src/lib/controls.ts`（消息工具栏与代码块动作）与 `src/lib/controls.test.ts`
- `entrypoints/content.ts`（`ACTION_ROSTER` 加 8 条）
- `src/lib/action.ts`（`BACKOFF_GATED_ACTIONS` 加 8 条，`SPEAK_GATED_ACTIONS` 加 `message.retry`）及测试
- `protocol/fixtures/action.json`（成功 / 工具栏不符 / 越界等样例）
- `protocol/evidence/controls.json`（新增十余条存证）
- `openspec/specs/frontend/spec.md`（经归档同步）
- 不改失败码册子、不改 `site-dom` 锚点
- 前置：真机抓存证与点验需要 ds-browser 已登录、停在一条有多轮 assistant 回答的会话
