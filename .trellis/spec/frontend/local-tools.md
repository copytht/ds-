# 本地工具（扩展自带的围栏工具）

围栏里装的是工具调用 JSON；绝大多数工具转发给中继（dsb）去执行。**本地工具**是例外：
名字在扩展自己的一张名册里（`src/lib/localtools.ts`），background 认出后**就地执行**，
不转发 dsb（ADR-0013）。v1 只有 `send.page` 一件。

## 1. 触发条件

- 围栏正文 → `parseToolCall` → `tool` 命中 `findLocalTool` → 本地执行；未命中照旧转发 dsb。
- 截获点在 `entrypoints/background.ts` 的 `sendCall(call, tabId)`：`parseToolCall` 之后、
  `fetch` 之前。普通工具（dsb）路径一字不改。

## 2. 签名

```ts
type LocalToolEnv = {
  readonly tabId: number | undefined; // 围栏来自哪个标签页
  readonly run: (action: string, params: Record<string, unknown>) => Promise<ActionOutcome>;
};
type LocalTool = {
  readonly name: string; // 协议说明里排的名字
  readonly description: string; // 一句话，进协议说明
  readonly params: readonly string[]; // ["question", "seconds?"]
  readonly run: (args: Record<string, unknown>, env: LocalToolEnv) => Promise<ReplyPayload>;
};
findLocalTool(name: string): LocalTool | null;
```

## 3. 契约：`send.page`

- 入参 `arguments`：`question`（非空字符串，必填）、`seconds`（可选，缺省 25、钳 1..25，
  与 `wait.ts` 同口径）。
- 执行四步：`composer.type({text})` → `send.enter({})` → `wait.fence({timeout})` →
  `wait.reply({timeout})`，全走 `runAction`（总开关 / 替人发言 / 退避三道闸照拦）。
- 成功：`okPayload(回灌正文)`——把 `wait.reply` 的 `{text}` 经 `parseReplyPayload` 解回正文。
- 失败：`errorPayload(码)`，码全取现成册子（不新增）。失败不进对话流（`isInjectableReply` 挡）。
- **不自我转发**：模型排出的那条围栏由既有路径（`content → background.onMessage → sendCall`）
  独立转发 dsb 并回灌；组合**只等、不转发**，所以不会双执行。

## 4. 校验与错误矩阵

| 条件 | 返回 |
| --- | --- |
| 消息不带 tab（`tabId === undefined`） | `tab-gone` |
| 同一标签页已有本地工具在跑 | `okPayload`（可见提示，不并发） |
| `question` 缺 / 空 / 非串 | `unknown-action`（不发送） |
| 总开关关 / 替人发言闸关（`composer.type` / `send.enter`） | `disabled`（页面不发送） |
| 退避中 | `backing-off` |
| 等围栏 / 等回灌 25s 没等到 | `timeout` |
| 回灌解不出（`parseReplyPayload` 回 null） | `page-changed` |

## 5. Good / Base / Bad

- Good：四步依次成，`wait.reply` 解出 `answer`，`okPayload` 回灌给模型。
- Base：模型没排围栏（直接口语作答）→ `wait.fence` `timeout`——issue 的四步口径如此，不改。
- Bad：用「不是 X」反推一个控件（如把发送键当停止键）；本地工具也一样：认不出就回册子里的码，不猜。

## 6. 必须的测试（断言点）

- `src/lib/localtools.test.ts`：四步**顺序与入参**；任一步没成即停、原码回；`question` 校验；
  `seconds` 归一；回灌解出正文；解不出回 `page-changed`。
- `src/lib/reply.test.ts`：`buildReply` ↔ `parseReplyPayload` 往返（单行 / 多行 / 空 / error）；
  坏输入回 null。
- `src/lib/instructions.test.ts`：名册元数据（名字 / 参数 / 说明）与协议说明文案**对拍**
  （任一边改动即红，防两处漂移）。

## 7. Wrong vs Correct

### Wrong

```ts
// 本地组合自己也把模型那条围栏转发给 dsb → 双执行
// 或：本地工具失败时 applyOutcome，把中继图标翻红
```

### Correct

```ts
// 组合只做页面动作：composer.type → send.enter → wait.fence → wait.reply；
// 模型那条围栏交给既有的转发路径。
// 失败只进控制台，不碰中继图标（本地工具一次 fetch 都没打）。
```

## 常见误区

- **本地工具碰中继图标**：本地工具一次 fetch 都没打，它的成败证明不了中继健不健康——闸关着
  回 `disabled` 是用户自己关的，不是中继坏了。与 `deliverNudge` 同口径：失败只进控制台，
  不 `applyOutcome`、不留失败痕。
- **名册元数据与说明文案两处分家**：`description` / `params` 是给协议说明用的；改一边漏另一边
  会让模型看到错的名字 / 参数。`instructions.test.ts` 的守卫测试盯着这条。
- **本地工具进 `ACTION_ROSTER`**：那是**页面动作**的名册（内容脚本执行）；本地工具是**围栏工具**
  的名册（background 执行），两码事，别混。
