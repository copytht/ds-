## Context

- `chat.new`（`src/lib/page.ts` 的 `newChat`）是最近的同类：按文字找侧栏条目、`el.click()`、回 `{}`，找不到抛
  `PageError(ACTION_ERROR_PAGE_CHANGED)`；它在 `BACKOFF_GATED_ACTIONS` 里、不在 `SPEAK_GATED_ACTIONS` 里。
- `think.set` / `search.set` 的前车之鉴（2026-10-07 真机）：点完**立即回读**会读到旧值——站点异步生效。
  `chat.switch` 同理：点完马上读 `location.href` 一定还是旧的。所以动作**不回读**，核实交给调用方用
  `page.state` 的 `url`（它已返回 `location.href`）。
- 真机口径（`chat-switch` 归档，存证 `sidebar.chat-row`）：条目 `a[href^="/a/chat/s/"]`，`href` 末段是会话 id；
  标题是条目 `textContent`（「更多」按钮只有 svg 没有字，所以整条 `textContent` 去空白就是标题）；
  当前会话的 `href` 等于 `location.pathname`；真机侧栏有 5 条同名会话。
- 四处对齐（spec「页面动作四处对齐」）：执行器 → 名册 → `action.json` → 同名共置测试。
- 写动作登记闸门（spec）：会改页面状态的写动作记进 `BACKOFF_GATED_ACTIONS`；动写作框的才进 `SPEAK_GATED_ACTIONS`。

## Goals / Non-Goals

**Goals:**

- `chats.list`（只读）与 `chat.switch`（写）进 v1 名册，四处对齐，真机点验。
- 歧义时拒绝，不替人选一条。

**Non-Goals:**

- 不等切换完成、不等消息列表渲染（调用方 `page.state` + `wait.*` / `messages.list` 自己等）。
- 不做标题模糊匹配、不做分页/滚动加载更多侧栏条目。
- 不做跨标签页切换；不碰 #66 B 的 11 项。

## Decisions

### 1. 配一个只读 `chats.list`，不让 agent 靠猜标题

真机有 5 条同名，单靠 `title` 无法唯一指定；agent 不读列表就拿不到 `id`。读写成对是仓里的既有形状
（`think.get/set`、`button.get/click`）。**否决**只做 `chat.switch`：重名时它只能拒绝，agent 无路可走。
`chats.list` 不进任何闸（读，同 `messages.list`），也不要求新存证——它读的就是同一批 `sidebar.chat-row`。

### 2. 参数 `{id}` xor `{title}`，歧义回 `unknown-action`

`unknown-action` 在仓里已经是「参数认不出形状」的口径（`enabled` 非布尔）。标题命中多条是**参数不够指明一个**，
同一类。**否决**新增失败码——spec「失败码只取现成册子」。**否决**「重名就点第一条」——误切会话
会让下一轮 `composer.type` 写进别人的对话，后果比拒绝重。

### 3. 动作不回读，核实交给 `page.state`

点击后立刻读 `location` 会读到旧值（`think.set` 已踩过）。回 `{}`，调用方核实：`page.state` 的 `url` 以
`/a/chat/s/<id>` 结尾即落点。这与 `chat.new` 一致（它也不核实）。

### 4. 切到当前会话：不点，回 `{}`

幂等——同 `think.set` 已在目标态就不动。点当前会话的链接要么无事发生，要么触发一次多余路由；不点最稳。

### 5. 闸：退避，不进 speak

切换改页面状态，所以进 `BACKOFF_GATED_ACTIONS`（账号在处罚区时与 `chat.new` 同样拦）。它不动写作框、不「代你发言」，
所以**不进** `SPEAK_GATED_ACTIONS`，「替你发言」闸关着时仍可切换。

### 6. 回归用例的原件取自存证

`evidenceHtml("sidebar.chat-row")` 取一条真机 `<a>`，用例用最小变形（换 `href` 的 uuid、换标题文字）造出多条、
重名、当前会话三类；**不手抄**一整条（对拍栅栏会红）。

## Risks / Trade-offs

- [`el.click()` 点 `<a>` 在站点上是 SPA 路由还是整页刷新，未实测] → 真机点验第一项就验；若是整页刷新，
  内容脚本的回包可能丢（回 `tab-gone`），则本设计的「回 `{}`」要改写——停下来改 artifact，不硬上。
- [侧栏收起时条目可能不渲染，`chats.list` 回空会被误读成「没有会话」] → 真机核实侧栏收起时的 DOM；若确实不渲染，
  改回 `page-changed`（读不到 ≠ 没有），并更新 spec 的「侧栏上没有会话条目」场景。
- [侧栏只渲染已加载的条目（滚动加载），超出的会话看不到] → 接受：`chats.list` 如实报「当前侧栏上有的」，
  文档里写明；不做滚动。
- [切换时写作框里未发送的草稿可能丢] → 站点行为，不在本动作范围；agent 一般在一轮结束后才切。
- [标题含首尾空白/不可见字符导致比不中] → 比较前去前后空白，其余严格相等（同 `findToggle`）。

## Open Questions

- 侧栏收起（`sidebar.collapse` 候补）时 `a[href^="/a/chat/s/"]` 还在 DOM 吗？真机点验时顺带验，结果决定上面第二条风险的走向。
- 本 change 不引入新的长期架构决策。
