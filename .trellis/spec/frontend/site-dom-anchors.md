# 抓站点 DOM 的锚点契约（chat.deepseek.com）

读对话（`src/lib/messages.ts`）与等动作（`src/lib/wait.ts`）都只碰**页面渲染出来的 DOM**
（#20 的口径：不 hook 请求/响应体、不解析站点 JSON、不直连接口）。站点不保证 DOM 稳定——
2026-10-04 一天里就见过两版标记，所以锚点怎么挑、变了怎么办，都在这一页定死。

## 只认语义 / 结构锚，不碰哈希 class

站点消息区的 class 大多是哈希（`_81e7b5e`、`_9663006`……），**不认**（#15）。可认的只有：

| 锚 | 用途 | 稳定性 |
| --- | --- | --- |
| `.ds-virtual-list` / `.ds-virtual-list-items` / `.ds-virtual-list-visible-items` | 列表容器（设计系统类） | 稳 |
| 行的 `data-virtual-list-item-key` | 老版行 key | 见过（会带符号） |
| `.ds-assistant-message-main-content` / `.ds-collapsible-text` / `.ds-message` | 老版角色与正文 | 新版**没了** |
| 「visible-items 的直接子元素」 | 新版行（没 key、没 `.ds-message`） | 稳（结构位） |

于是行锚是**两条并列**：`[data-virtual-list-item-key], .ds-virtual-list-visible-items > *`——
老版挂 key 的行、新版只有哈希 class 的行都落进来。角色判据（`readRow`）认不到就回 `null`，
**不猜角色**；`wait.*` 只读正文（`rowText`，角色无关），所以新版没 role 判据也不影响它。

## `wait.*` 的「新行」判据：比「见过没有」，不比数值大小

行 key **带符号**（真机样本：`-2` 问题 / `2` 围栏 / `-4` 回灌 / `4` 答复）——一个来回两条
**同值不同号**。所以：

- `key > 基线` 漏负 key（#37 的原始症状）；
- `|key| > 基线` 漏**同来回的对面那条**（问题定基线 2，围栏 2 就不算新）——真机上就是这么漏的。

正解：基线记**行的 key 集合** + **无 key 行的正文集合**，之后只认「基线里没见过」的那条。
视口里重新挂出的旧行（滚动造成的）key/正文都在基线里，不会误认成新消息。

## `wait.*` 等挂载，不当场报错

列表不是「动作一到就挂好」的（首页发完第一条要跨一次导航才挂）。`wait.*` 在预算内轮询等
`conversation()` 认得出来；到点仍没有才是 `page-changed`。等不到新消息是 `timeout`，两者别混。

## 围栏在 DOM 里的样子（新版）

站点把 ```send 渲染成**代码块**：表头「send」+ 复制/下载按钮 + `<pre>` 正文——**原文的 ```
标记没了**。`messages.ts` 读行文本时把 `<pre>` 还原成一段围栏：正文能 `parseToolCall` 就写回
```send，否则写普通的 ```。所以 `rowText` 出来的文本，`parseSendFence` 照样认。

## 工具调用解析住哪

`parseToolCall` / `MALFORMED_CALL_HINT` 住在 `src/lib/fence.ts`（围栏域）——因为**读 DOM** 的
那半边也要认工具调用（还原围栏）。`src/lib/relay.ts` 转出它们，中继那条线的调用方照旧从
`./relay` 取。

## 站点变了怎么办

改锚点 + 在同一次提交里补**照抄真机结构的 fixture**（`messages.test.ts` / `wait.test.ts`）。
真机复验（`scripts/env-up.sh --debug` + `scripts/page-action.py`）是最后一道；站点再换版，
单测 + 真机会先红。
