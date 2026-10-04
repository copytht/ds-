# Design — stop.click + chat.new（页面动作 7/8）

## 边界

- 只动**扩展层**（`entrypoints/` + `src/`）。**不碰 dsb**：ADR-0011 之后 dsb 侧没有动作名册，
  两处册子只剩 `protocol/fixtures/action.json` 的 `errorCodes` ↔ `src/lib/action.ts` 的
  `ACTION_ERROR_*`。
- 不新增端点、不新增消息类型。`stop.click` 走既有 `ActionFrame` → `ACTION_ROSTER` → `PageError`
  这条一跳路，与 `send.click` 同形。

## 涉及文件

| 文件 | 改动 |
| --- | --- |
| `src/lib/page.ts` | 新增 `findStopButton()` / `stopClick()` 与停止键选择器 |
| `entrypoints/content.ts` | `ACTION_ROSTER` 增 `"stop.click": stopClick` |
| `src/lib/action.ts` | `stop.click` 并进 `BACKOFF_GATED_ACTIONS` |
| `protocol/fixtures/action.json` | 增「stop.click 成功」样例（`{:150}` 附近，与 `chat.new` 并列） |
| `src/lib/page.test.ts` | 命中 / 找不到两条 + 真机 DOM 回归用例 |
| `src/lib/action.test.ts` | `stop.click` 受退避闸一条（对齐 `chat.new` 的 `:468`） |

## 契约

- 动作名 `stop.click`，`params: {}`，成功 `result: {}`（与 `send.click` 同形）。
- 失败：页面上找不到认得的停止键 → `PageError(ACTION_ERROR_PAGE_CHANGED)`（错误码已在册，
  不新增码，两处册子无需同步新码）。
- `ACTION_ROSTER` 是名册真源；fixture 是跨语言对拍样例。

## 选择器策略（真机已确认，2026-10-04）

真机两次抓取（生成中 / 空闲，见 `research/stop-button-dumps.md`）证实：**停止键与发送键是
同一个元素、同一套 class**（`div[role="button"].ds-button--primary.ds-button--filled
.ds-button--circle…`），`aria-label` 为空——所以只能**认图标**：

1. 先认语义标记：`[aria-label]` 文本含「停止」/「Stop」（站点若给；真机上现在没有，留作兜底）；
2. 否则认圆键里的图标 `path`：方块 `M2 4.88C2 3.68009…` = 停止，箭头 `M8.3125 0.980206…` = 发送；
3. 认不出（含空闲时是发送箭头）就抛 `page-changed`，**绝不误点发送**。

**与原计划的一处偏离**：计划原先写「不按图标 `path` 匹配（随部署变）」，但 dump 证明
`aria-label` 空、class 完全相同，图标是唯一 fail-safe 判别面——故改为按图标前缀匹配。
站点换图标即失配 → `page-changed`（宁可报找不到，也不误发）。哈希 class（`_52c986b` /
`bd74640a` 等）仍不碰，只出现在测试的 DOM 样例里。

> 关键未定点的收口：`stop.click` 与 `send.click` **就是同一个圆的那个键**（生成期箭头变方块），
> 不是旁边另一个键。选择器按 dump 结果写成常量（`STOP_ICON_PREFIX`），与 `SEND_SELECTOR` 并列，
> 真机 DOM 落成回归用例。

**不做的事**：不按哈希 class 匹配，不按 `data-testid`（真页面上没有）。

## 闸门归属

- **不是 `SPEAK_GATED_ACTIONS`**：它不动写作框，不属于「替人开口」（`src/lib/action.ts:96-101`）。
- **并进 `BACKOFF_GATED_ACTIONS`**：它改变页面状态，与 `chat.new` 同口径
  （`src/lib/action.ts:103-113` 的注释：「会改变页面状态的那些」）。账号在处罚区时写动作一律
  拦下；禁言时本也发不起生成，实际不影响使用。
  - 取舍：若判它属「减少活动」的安全动作而**不**入退避闸，则账号中途被禁言时仍能喊停；但会与
    `chat.new` 的口径不一致，且退避闸的本意是「别往处罚区堆活」。本设计取**一致优先**。
  - 无当前内部调用方：此归属只为口径一致与将来内部使用；不改变现有出站 / 看门狗行为。

## chat.new

- 已实现且契约齐全，本任务**不改代码**，只做 #21 的真机确认（点后 url 变化）。
- 既有定位用本地化文字「开启新对话」（`src/lib/page.ts:195`），认不出抛 `page-changed`；不在本
  任务扩大为 icon/aria 定位（那是 #30 的范围），避免 scope creep。

## 数据流

```
调用方（出站 / 看门狗 / 将来内部）
  → runAction(frame("stop.click"), ctx)         // 总开关 → 闸 → 退避探针
  → context.sendToTab(tabId, frame)
  → browser.tabs.sendMessage → content.ts ACTION_ROSTER["stop.click"]
  → stopClick(frame)                            // 页面里 findStopButton + click
  → ActionOutcome {ok:true,result:{}} | {ok:false,error:"page-changed"}
```

## 风险与延后

- **选择器随站点改版碎**：用设计系统类 + 语义属性；真机 DOM 落成回归用例，改版时先红。
- **真机确认依赖账号可生成**：账号若仍禁言则 R5/验收第 1、3、6 条延后，其余（执行器 + 名册 +
  契约 + 单测）照常落地。选择器先按策略写、显式注明「未经真机确认」。
- **发送键与停止键可能是同一元素**：dump 时对同一位置在「空闲」与「生成中」各抓一次做 diff，
  两种形态都能写对。
- **回滚点**：改动集中在 6 个文件，按文件粒度回退；无数据 / 配置迁移。

## 验证手段

- 单测（vitest + jsdom）：命中点击、找不到抛 `page-changed`、真机 DOM 回归、退避闸归属。
- 契约门：`src/lib/fixtures.test.ts` + `tests/test_fixtures.py`（两半共读 `action.json`）。
- `pnpm quality`：TS 与 Python 两半一起过。
- 真机：人配合控制台 dump（选择器确认）+ 点「开启新对话」看 url（chat.new 验收）。
