# Proposal

## Why

**续聊（ADR-0014）这条链路在 openspec 里一条 requirement 都没有。** grep `continuation` /
`续聊` / `短标记` / `rounds` 在整个 `openspec/` 下 0 命中——五篇 spec 覆盖
`site-dom` / `frontend` / `backend` / `local-tools` / `conventions`，唯独漏了它。

后果不是「spec 不齐全」这种抽象问题，而是**四个已知缺陷全从这个洞里漏出来**：

| 缺陷                                                                                                                     | 缺哪条 requirement                                                                    |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| #47 `send.page` 必然 `page-changed`（ADR-0014 改了口径，`wait.reply` 等到的变成短标记，而 `local-tools` 的 spec 没跟上） | 没有一条说「回灌进页面的正文是什么形状」                                              |
| #48「唯一出站口」有第二条路（`deliverNudge` / `send.page` 不经 `gate.ts`）                                               | 没有一条管「哪些发送路径受哪些闸约束」                                                |
| #49 武装 TTL 30s vs 出站窗口 3–5s（保护窗口比危险窗口短 6–10 倍）                                                        | 「宁可少一轮也不能吃人说的话」只在注释里，没人算过比例                                |
| #51 `sendToPage` 失败零留痕                                                                                              | 「失败只进控制台」是 `local-tools` 对**模型调用**的口径，续聊自己那份没有 requirement |

它们共同的形状是：**口径只活在 ADR 正文与代码注释里**。注释不参与 `openspec validate`，
改 ADR 不会让任何一扇门变红。

## What Changes

**补一个能力 `continuation`：自动续聊（回灌）这条链路。** 只写 requirement，**不改代码**
——代码的偏差由 #47–#52 各自去修。

- **ADDED**（新能力 `continuation`）：
  - 正文走请求体、对话里只留两行短标记（ADR-0014 的核心决定）
  - 武装在出站窗口放行那一刻，且一次即作废
  - 轮数刹车 8 轮，到顶停手并归零；什么算「任务收尾」与「换会话」
  - 结果截断 2000 字并写明已截断
  - 出站窗口是**哪几条路径**的收口（把 #48 那句错的文档写对）
  - 失败一律作废这一轮、不重试、输入框不留半截、不退回长消息
  - 结果没送到模型手上与中继没连上是两件事

- **MODIFIED**（`local-tools`）：`send.page` 的返回形状与 `wait.reply` 的口径，
  **并标注为待定**——修法（撤掉 / 拆两个 / 等正文）要人拍板（#47），这里只把
  「三方证据与真实链路不一致」这件事写成 requirement 的现状注记，不擅自定新口径。

## Capabilities

### New Capabilities

- `continuation`：自动续聊/回灌这条链路——正文走请求体、武装时机、轮数刹车、截断、
  出站窗口的收口范围、失败处置。

### Modified Capabilities

- `local-tools`：`send.page` 的返回与 `wait.reply` 口径（现状与真实链路不符，见 #47）。

## Impact

- 代码：**不动**。
- spec：新增 `openspec/specs/continuation/spec.md`；`local-tools` 改一条 requirement。
- 后续：这四条 requirement 会直接指出 #47–#51 各自该改成什么样；`send.page` 的口径
  仍需人拍板，spec 里标为待定而不是先填一个数。
- 与 ADR 的关系：本 change 是把 ADR-0014 + ADR-0002 的决定**落成可校验的 requirement**，
  不是新决定。ADR 本身不改。
