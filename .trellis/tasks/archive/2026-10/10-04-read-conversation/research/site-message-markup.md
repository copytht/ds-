# 读对话：站点标记的真机事实（2026-10-04）

只读探针（`scripts/page-action.py js` / `read` / `ax` / `send`）取的，未发站点消息。

## 1. 主对话列表用的是**经典标记**，`messages.*` 其实读得出

同一页上并存两条 `.ds-virtual-list`（真机量过几何）：

| 列表 | class | 尺寸 / 可滚 | 行 |
| --- | --- | --- | --- |
| **主区（真实对话）** | `ds-virtual-list ds-virtual-list--printable` | 1209×742，`overflowY:auto`，`scrollH 2074 > clientH 742` | 有 `data-virtual-list-item-key`；`.ds-message` + `.ds-assistant-message-main-content`（助手）/ `.ds-collapsible-text`（用户） |
| 小面板 | `ds-virtual-list` | 240×210 | `div._81e7b5e`（**无 key、无 `.ds-*`**），内容是用户侧消息 |

`--printable` 那条**不是**只给打印用的隐藏副本——它就是可视、可滚的主对话。

**真机实测**：`send messages.last` →
`{"ok":true,"result":{"messages":[{"role":"assistant","text":"你还没给出具体要做什么。…"}]}}`
——**角色与正文都读得出**，`readRow` 走的正是 `.ds-assistant-message-main-content`。

## 2. 早先那次「`.ds-*` 全为 0」是另一种渲染态（不是当前常态）

当天早些时候在同一浏览器里量到过：`.ds-message / .ds-assistant-message-main-content /
.ds-collapsible-text / .ds-markdown / [data-virtual-list-item-key]` **全为 0**，行只剩
`div._81e7b5e`。当时据此判「`messages.*` 角色判据没了」。

现在复现不出来：主列表回到经典标记、`messages.last` 正常。**存疑**——可能是站点 A/B 的
另一套渲染，也可能是当时那屏只挂了小面板 / 渲染中间态。**没有稳定复现，不算已定缺陷。**

## 3. 无障碍层（AX，503 节点）——半个赢

| 找什么 | AX 里 | 可用 |
| --- | --- | --- |
| 输入框 | `textbox` 名 = `给 DeepSeek 发送消息`，`editable=plaintext` | ✅ |
| 侧栏对话 | `link` 名 = 会话标题 | ✅ |
| 发送 / 停止 / 新对话按钮 | `button` **无名**（全树 37 个 button 名字都空） | ❌ |
| 消息正文 | 无名 `paragraph`/`generic` 下的 `StaticText` | ⚠️ 文本能读、**角色判不出** |
| 围栏代码块 | **没有 `code` role** | ❌ |

角色直方图：`generic 191 / none 105 / InlineTextBox 49 / image 41 / StaticText 40 /
button 37 / paragraph 13 / link 9 / listitem 7 / textbox 1`。

## 4. 控件层没随换版断（顺带查的）

- 输入框 `textarea, [contenteditable='true']` → 1；发送圆键
  `div[role=button].ds-button--primary.ds-button--filled.ds-button--circle` → 1；
  `[tabindex=0]` 里 `开启新对话` 在列。
- 扩展自己的 `page.state`：`circleIcon` = 记录的发送箭头前缀
  `M8.3125 0.980206…`、`stopDetect.isSend=true`、`circleDisabled=true`（空输入框）
  → `send.click` / `stop.click` / `chat.new` 的判据都还认得出。**没断。**

## 结论

- 「读对话」当前**没有可复现的缺陷**；`messages.*` 真机可用。
- 站点确有一套**无 `ds-*`、无 role、无 key** 的行渲染（`_81e7b5e`）存在于小面板，
  主列表是否也会切过去**未定**。
- 若要防它：别再造大重构，加**一条能说清的守卫/兜底**即可（认不出角色时老实报
  `page-changed`，别把空对话或错角色交上去）——现有 `readRow` 回 null + `listMessages`
  抛 `page-changed` 已基本是这个行为，值得补一条测试钉住。
