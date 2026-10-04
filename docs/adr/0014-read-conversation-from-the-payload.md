# 读对话允许读站点载荷：角色取 `chat_message_role`

`#20` 定过一条口径：读对话（`messages.*`）**数据源只有渲染出来的 DOM**——不 hook 请求 /
响应体、不解析站点的消息 JSON、不直连接口。上一版走 `history_messages` 响应体拦截，被撤了。

2026-10-04 站点换版把消息区的设计系统类撤掉（`.ds-message` / `.ds-assistant-message-main-content`
/ `.ds-collapsible-text` 在另一套渲染里没有），DOM 判角色的地基开始漂。按「先拿完整证据」的
流程 `capture --codes` 抓下站点 JS，读到消息模型**自带角色字段**：

```js
…chat_message_role:"user"      full_chat_message_id:…
…chat_message_role:"assistant" full_chat_message_id:…
```

而扩展**本来就在**包 `fetch` / `XMLHttpRequest`（`entrypoints/inject.content.ts`）：一是注入
协议说明，二是读响应体喂围栏检测（`src/lib/answer.ts`）。也就是说这条管子是现成的、只读的。

**决定**：读对话**可以**把站点请求 / 响应体当数据源，角色以载荷里的 `chat_message_role` 为准。
`#20` 的「数据源只有渲染出来的内容」据此修改。

## 解析顺序（首个命中为准，认不出不猜）

1. **载荷**：消息模型自带角色 → 最硬、与标记无关（主源）；
2. **标记层**：行上还留着 `ds-*` 角色类 → 直接用（零回归）；
3. **渲染层**：人看的气泡（不满宽圆角块 / 头像圆）→ user，素文 → assistant（兜底）；
4. 都不中 → `unknown`（**不猜**：标错角色比读不到更坏）。

## 边界（这条口子只开这么大）

- **只读**：不改写请求体（唯一例外是既有的协议说明注入）、不改响应、不直连站点接口；
  载荷只在本机内存里过一遍，不外传、不落盘。
- **只用于读对话**：不拿它做别的（不重放、不伪造、不旁路站点的发送路径）。
- **兜底仍在**：载荷没有（非亲历的历史、站点改了字段名）时退回 DOM 两层，最后 `unknown`——
  单点失效不会让整条线断，也不会退化成猜。
- 站点字段名（`chat_message_role`）是**数据契约**，会变；变了就是 `unknown` + 单测先红，
  不是静默错。

## 为什么不继续吊在 DOM 上

DOM 的角色线索是**站点渲染的副产品**：同一份包里有 `.ds-assistant-message-main-content`
与 `_81e7b5e` 两条分支（A/B），今天是哪条不由我们定。而 `chat_message_role` 是**数据**——
站点自己要用它决定怎么渲染，腾挪空间小得多。
