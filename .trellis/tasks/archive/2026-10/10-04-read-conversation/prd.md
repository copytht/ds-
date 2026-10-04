# 读对话：角色判据换成「渲染出来的样子」

来源：站点 2026-10-04 换版（见 `research/site-message-markup.md`）。`messages.*` 现在能读，
但**角色**靠站点的设计系统类（`.ds-assistant-message-main-content` / `.ds-collapsible-text`）；
换版把这批类从另一套渲染里撤了，角色就判不出。

## Goal

`messages.list` / `messages.last` 的**角色**不再以站点的设计系统类 / 哈希类为依据，
改用**人眼也在用的那个信号**：消息**渲染出来的样子**（用户行画气泡、助手行素文）。

## 事实（真机量过，2026-10-04）

| 角色 | 渲染 |
| --- | --- |
| 用户 | 一个 `border-radius: 22px`、底色 `rgb(237, 243, 254)` 的圆角块，**右缘贴行右缘**；另有一个 30px 圆形头像 |
| 助手 | **一个带底色的元素都没有**——整宽素文 |

## Acceptance Criteria

- [ ] 角色判据**不依赖** `.ds-assistant-message-main-content` / `.ds-collapsible-text` /
      `.ds-message`，也不依赖哈希 class。
- [ ] 站点两套渲染下都能判出角色（有 `ds-*` 时走标记层；没有时走渲染层）。
- [ ] **气泡 vs 助手内容底色**分得开（代码块 / 表格也绘底色）——研究第 1 步钉死。
- [ ] 认不出 → `unknown`：不猜、不静默丢。
- [ ] 真机复验：`messages.list` / `messages.last` 角色 + 正文正确。
- [ ] `pnpm quality` 全绿。

## Out of Scope

- 写动作层（`composer.*` / `send.*` / `stop.click` / `chat.new`）——真机验过没断。
- 无障碍层（按钮无名、消息无 role）、截图 / OCR。
- **流式载荷 / 亲历账本 / 改 #20 口径 / ADR**——渲染层这条够用，不碰这些。

## 已定（评审 2026-10-04）

1. **角色 = 三层解析**：标记层（`ds-*` 角色类，零回归）→ 渲染层（气泡：不满宽圆角块 /
   头像圆；数字见 `research/role-bubble.md`）→ `unknown`。
2. **不做载荷层**：站点消息模型确实自带 `chat_message_role`（抓代码读到的），但用它要改 #20
   口径 + 多一条跨世界管子，而「角色认不出」一次都没复现——**不为没复现的病付这个价**。
3. **契约加 `unknown`**：`MessageRole = "user" | "assistant" | "unknown"`；
   同步 `protocol/` 样例与 Python 侧。
