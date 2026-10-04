# 设计：角色判据换成「渲染出来的样子」（气泡）+ 标记层兜底

## 问题

`readRow` 的角色靠站点的设计系统类。换版后某套渲染里这些类没了 → 角色判不出。
但**人眼一直分得出**：用户消息被画成一个圆角气泡（贴右、有底色、带头像），助手是整宽素文。
这个信号在**渲染结果**里（`getComputedStyle` / `getBoundingClientRect`），与 class 无关。

## 源头与取舍

| 源 | 判角色的能力 | 结论 |
| --- | --- | --- |
| DOM 标记（`ds-*` 角色类） | 准 | **保留**为第一层（有就用） |
| DOM 结构（行位置 + 文本） | **没有**角色 | 只用它取正文 |
| **渲染（几何 + 样式）** | **有**（气泡 = 人眼用的） | **本任务的主角** |
| 无障碍树 | 没有（消息行无名） | 不用 |
| 站点接口 | 有 | 不用（#20） |
| **流式载荷 / 亲历账本** | **有（`chat_message_role` 是数据字段）** | **本任务主源**（要立 ADR-0014 改 #20 口径：只读、不改写请求、不直连接口） |
| 截图 / OCR | 有 | 不用（重，且这条链的 agent 收不了图） |

## 决定：角色解析三层，首个命中为准，认不出不猜

1. **标记层**：行上还留着站点的设计系统类（`.ds-assistant-message-main-content` /
   `.ds-collapsible-text`）→ 直接用（今天真机实测可用，零回归）。
2. **渲染层（气泡）**：行内有**不满宽**的圆角绘制块（或 30px 头像圆）→ user；否则 assistant。
   判据与数字见 `research/role-bubble.md`；**颜色不作判据**（暗色主题底色全变）。
3. 都不中 → `unknown`。

**载荷层（不做）**：抓站点代码时读到消息模型自带 `chat_message_role`（`research/site-code.md`），
技术上也能当源——但那要改 #20 口径（立 ADR）、多一条跨世界管子，而「角色认不出」**一次都没复现**；
气泡这条已经够用且便宜。**看见锤子别就找钉子。**

**正文**：结构层 `rowText`（行 = `[data-virtual-list-item-key], .ds-virtual-list-visible-items > *`；
含既有的「`<pre>` 还原成围栏」）。

## 可测性（关键）

jsdom **不做布局**：`getBoundingClientRect` 全零、`getComputedStyle` 无真底色。
所以渲染层判据要留一个**探测口**：

```ts
type StyleProbe = {
  style: (el: Element) => Pick<CSSStyleDeclaration, "backgroundColor" | "borderRadius">;
  rect: (el: Element) => Pick<DOMRect, "left" | "right" | "width">;
};
export function roleOf(row: Element, probe: StyleProbe = domProbe): MessageRole
```

- 真机走 `domProbe`（`getComputedStyle` + `getBoundingClientRect`）。
- 单测喂**替身 probe**，把「气泡 / 代码块 / 表格 / 素文」四种样例喂进去，不必真布局。

## 待研究钉死（实现第 1 步）

助手回答里的**代码块 / 表格**也绘底色 → 必须证明「气泡」能与它们分开。草案判据：

- **圆角大小**：气泡 `22px`，内容块通常 ≤ 8px；
- **贴右**：气泡右缘 = 行右缘；内容块左对齐、右缘不到行右；
- **包住整行正文**：气泡包含该行大部分文本；内容块只覆盖一段。

拿真机上含 `<pre>` / 表格的助手行量出数字，把阈值与「都命中不了」的行为写进
`research/`，再照着写码。

## 契约

- `MessageRole = "user" | "assistant" | "unknown"`（同步 `protocol/` 样例与 Python 侧）。
- `readRow(row, probe?)`：三层解析；判不出 → `{role: "unknown", text}`，**不猜、不丢**。
- `messages.list` 如实带上 `unknown`；失败码不变（列表认不出仍 `page-changed`）。

## 风险

- **渲染层是启发式**：站点把气泡样式改掉（底色透明、圆角归零）就失配 → 落 `unknown`
  （不会误判成 assistant，代价可接受）。研究第 1 步把样例钉住，失配时单测先红。
- **jsdom 不布局**：必须靠探测口注入替身，否则测试是假的（这条写进 spec）。

## 验证

- 单测：替身 probe 下，用户气泡行 / 助手素文行 / 助手含代码块行 / 表格行 → 角色正确；
  无 `ds-*`、无气泡 → `unknown`。
- 真机：`messages.list` / `messages.last` 角色 + 正文正确（含一段带围栏/代码块的对话）。
- `pnpm quality` 全绿。
