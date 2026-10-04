# 抓站点 DOM 的锚点契约（chat.deepseek.com）

读对话（`src/lib/messages.ts`）与等动作（`src/lib/wait.ts`）都只碰**页面渲染出来的 DOM**
（#20 的口径：不 hook 请求/响应体、不解析站点 JSON、不直连接口）。站点不保证 DOM 稳定——
2026-10-04 一天里就见过两版标记，所以锚点怎么挑、变了怎么办，都在这一页定死。

## 换版了怎么查（固化流程，2026-10-04）

站点一换版，**先抓「完整的它」再下判断**——别靠零散探针拼结论。2026-10-04 吃过一次：
零散探针读出「`.ds-*` 全没了」，后来发现只是量到了**另一条**列表（小面板），主列表一直好着。

```bash
scripts/env-up.sh --debug                        # 带调试口的 ds-browser
uv run scripts/page-action.py capture --codes    # 落 captures/<时间戳>/
```

| 产物 | 是什么 |
| --- | --- |
| `page.html` | 完整 outerHTML（渲染后的 DOM） |
| `styles.css` | 同源 CSS 规则（读不到的跨源表留注释） |
| `assets.json` | 脚本 / 样式表 URL 清单 |
| `digest.json` | **行快照**：每行的 key / 标记角色 / 绘制的元素（底色 + 圆角 + 几何）/ 围栏数 |
| `ax.json` | 无障碍树 |
| `codes/` | 站点 JS 正文（走 CDP `Debugger.getScriptSource`，**跨源 CDN 也能取**） |

`captures/` 不进库（见 `.gitignore`）。

**先读 `codes/`**：站点的**真实规则**在里面。例：2026-10-04 在 `main.*.js` 里读到
`chat_message_role:"user"` / `"assistant"`（消息模型自带角色）与 `.ds-assistant-message-main-content`
`_81e7b5e` 并存——**两套标记是同一份代码的两个分支（A/B）**，不是两次发版。

## 角色怎么判（三层，首个命中为准，认不出不猜）

1. **标记层**：`.ds-assistant-message-main-content` / `.ds-collapsible-text`（零回归）；
2. **渲染层（气泡）**：人看的那层——用户行是**不满宽**的圆角绘制块（真机 22px 圆角）+ 30px 头像圆；
   助手行整宽素文、无绘制块。**颜色不作判据**（暗色主题底色全变）；判据数字见
   `10-04-read-conversation/research/role-bubble.md`；
3. 都不中 → `unknown`（**不猜**）。`MessageRole` 因它有第三个值。

**不做载荷层**：`chat_message_role` 确实能当源（比 DOM 硬），但要改 #20 口径 + 多一条跨世界
管子，而「角色认不出」一次都没复现——**看见锤子别就找钉子**（2026-10-04 用户拍板砍掉）。

## 只认语义 / 结构锚，不碰哈希 class

**这条的上一层是 [`guides/human-first-thinking-guide.md`](../guides/human-first-thinking-guide.md)**：
先问「人是怎么认的」，人用的信号（气泡、位置、样子）通常比 class 稳。角色判据就是照这条改的
（见下「角色三层解析」）。

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
