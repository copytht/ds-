## Context

- 已有同类：`chat.new` / `think.set` / `chat.switch`（`src/lib/page.ts`）：按控件找、`el.click()`、回 `{}`，
  找不到抛 `PageError(ACTION_ERROR_PAGE_CHANGED)`；写动作记进 `BACKOFF_GATED_ACTIONS`，动写作框 / 可能发言的才进
  `SPEAK_GATED_ACTIONS`（`button.click` 按最坏拦）。`page.ts` 已 400 行，`messages.ts` 668 行。
- 真机 2026-10-07 再探（ds-browser，一条 12 行对话）：
  - 12 个消息行：6 个 assistant 行每行一个 `div.ds-flex._965abe9` 工具栏，内含 6 颗 `[role=button].ds-button--iconLabelTertiary`；
    6 个用户行每行一个 `div.ds-flex._78e0558` 工具栏，只有 2 颗（复制 + 一颗 `aria-disabled=false` 的，疑为编辑）。
  - 工具栏**在行内、`.ds-message` 之外**（`inMsg: false`）。6 颗的图标起始 path 在所有 assistant 行里完全一致，
    第 2 颗 `aria-disabled=false`、第 5 颗 `aria-label="朗读"`——与 ADR-0018 的结论吻合。
  - 页头分享、侧栏搜索 / 收起**无文字、无 aria-label、无 title**；分享按钮祖先全是哈希 class；屏幕坐标随窗口宽度变。
- `messages.list` 是边滚动边把整段对话收进 `seen`（`messages.ts`），**工具栏只存在于当前挂载的行里**，
  两者的「第几条」不是同一个坐标系。
- 代码块真机结构与存证 `code.block` / `code.copy` / `code.download`（2026-10-07）已入档。
- spec 约束：定位优先 `ds-*` / `role` / `aria-*`、不碰哈希 class、图标不作判据；动作 fail-safe（认不出就
  `page-changed`，绝不猜）；ADR-0018（存证先行、回归用例读存证不手抄）。

## Goals / Non-Goals

**Goals:**

- 8 个动作进 v1 名册、四处对齐、回归用例读存证。
- 定位在结构不符时拒绝，不凭序号硬点。
- `message.retry` 进「代你发言」闸。

**Non-Goals:**

- 页头分享 / 侧栏搜索 / 侧栏收起（无语义锚，留候补，spec 更正描述）。
- 附件上传、模型选择。
- 把 `index` 对齐到 `messages.list` 的下标（做不到，见决定 2）。
- 回读点击结果（站点异步生效；`think.set` 已踩过）。

## Decisions

### 1. 新建 `src/lib/controls.ts`，不往 `page.ts` 里塞

`page.ts` 已装着圆键 / 写作框 / 开关 / 会话切换，再塞 8 个只会更长；spec「一主题一文件」要求先看现成文件能否
复用——工具栏与代码块是**对话内容里的控件**，主题与 `messages.ts` 相邻而不同（后者只读）。
新文件复用 `messages.ts` 导出的 `conversationList`，不重造「认出对话列表」。`ACTION_ROSTER` 在 `content.ts` 接线。

### 2. `index` 数「当前挂载的」，负数从末尾数

工具栏只在挂载的行里，而 `messages.list` 的数组覆盖整段对话。强行让 `index` 对齐 `messages.list` 要么得把目标行
滚进视口再点（会滚动页面，是新的副作用），要么对没挂载的行谎称成功。**否决**。采用「挂载集合内位置 + 负数从末尾」：
最常见的用法就是对**最新一条**回答动手（`-1`），正好是挂载的。非负 `index` 保留给「先看一眼再点」的场景。
`code.*` 同口径，集合是对话列表内挂载的 `div.md-code-block`（文档序）。

### 3. 工具栏定位：「恰好 6 颗 + 朗读在第 5 颗」双重校验

6 颗按钮同形，身份只靠 DOM 序。只要有一处不符——容器里不是恰好 6 颗、`朗读` 不在第 5 位——就当结构变了，
`page-changed`、不点。这样站点多加 / 少一颗按钮时，宁可停也不会把「点赞」点成「不喜欢」。
**否决**按图标 `path` 认（违反 spec；图标只作存证）；**否决**按悬停 tooltip 认（jsdom 测不到，执行时也要派事件）。
用户消息行的工具栏只有 2 颗，自然落入「不符」，回 `page-changed`——不需要另做「角色判断」。

### 4. 闸：全进退避；retry 另进 speak

退避闸管「改页面状态」，8 个都是写。`message.retry` 让账号重新生成一条回答，等同发送；`button.click` 已立下「可能
替你开口就按最坏拦」的先例，retry 同理进 `SPEAK_GATED_ACTIONS`。copy / like / dislike / read / share / code.\* 不动写作框、
不发言，**不进** speak 闸。

### 5. 返回 `{}`，不回读

`copy` 写剪贴板、`download` 落文件、`like` 切状态——站点异步生效，点完立即读是旧值（`think.set` 前车）。
调用方要核实就自己读（如 `messages.list` 看内容、或下一次读工具栏的 `aria-*`）。

### 6. 真机点验的边界

只点**可逆且无外部副作用**的：`message.copy`、`code.copy`（读剪贴板核实；合成点击不是可信用户手势，**可能写不进剪贴板——
这本身就是要查的事实**）、`message.like` 点完再点一次复原（对象选「探针测试」会话里的测试消息）。
**不点**：`message.retry`（真生成）、`message.dislike` / `message.share`（会弹面板，关面板要派事件）、`message.read`
（出声）、`code.download`（往用户机器写文件）。这些靠 jsdom + 存证 + 定位校验覆盖，票里记「未验证项」。

## Risks / Trade-offs

- [合成 `el.click()` 不带用户激活，站点可能拒绝 copy / download / read] → 点验时先查；若确认被拒，该动作回 `{}` 但实际无效，
  spec 要加「点了不等于生效」的说明，或改走别的路径——停下来改 artifact，不硬上。
- [`index` 的坐标系与 `messages.list` 不同，agent 容易混] → spec 与 `instructions` 都写明；推荐只用 `-1`。
- [站点虚拟列表卸载行] → 点击在同一同步段内完成（找行→点），不跨 await，不存在「找到后被卸载」。
- [6 颗数量 / 顺序站点改版] → 双重校验拒绝；存证对账（`page-action.py evidence`）会点名过时。
- [点 `like` 可能写入账号的反馈数据] → 点验只对「探针测试」会话里的测试消息做，且点完复原。
- [`message.retry` 的 speak 闸让它在默认配置下点不了] → 与 `send.enter` 一致，是有意的；`speak` 开关在选项页。

## Open Questions

- 用户消息工具栏第 2 颗（`aria-disabled=false`）疑为「编辑」，用途未认出——**不登记、不编名**，只入存证作反例。
- `message.like` 点第二次是取消还是无事发生？点验时记录，写进 spec 或留作「站点行为」。
- `instructions.ts` 里要不要给模型讲这 8 个动作？页面动作目前没有外露调用面（ADR-0011），暂不需要；若以后有，另开 change。
- 本 change 不引入新的长期架构决策。
