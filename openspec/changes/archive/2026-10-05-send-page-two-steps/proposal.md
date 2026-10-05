# Proposal

## Why

`send.page` 的四步链条（`composer.type` → `send.enter` → `wait.fence` → `wait.reply`）是
**ADR-0014 之前**的世界画的。ADR-0014 把工具结果从「一条可见的长 TOON 消息」改成
「出站请求体替换 + 两行短标记进对话」，而这条链条的三段各自失去了对象：

1. **三重自指**：`wait.reply` 等的是**首行锚 `agent:` 的回灌**——而那正是 `send.page`
   自己触发的那一轮工具结果。所以「取答复」取的是自己刚触发的东西，同一份工具结果被
   回灌**两次**（`background.ts:571` 每块围栏都包一层 `okPayload` 回灌，`send.page` 的
   返回值又包一层）。`instructions.ts:50` 向模型承诺「返回答复正文」——**这个承诺是假的**。
2. **`wait.fence` 等的东西被另一条路处理**：它等的是页面模型排的围栏，而那条围栏被
   `inject.content.ts:206` `detect()` 捕获后走 `sendCalls`，与本地工具这条路无关。
3. **模型读不到回答**：页面动作**没有 MCP 工具面**（`dsb/` 下 0 处动作名，`background.ts:619`
   的工具目录只取 dsb 的 `tools/list`），所以「让工具替模型读回页面回答」这条路本来就不通。

净效果（#47）：`send.page` **每次都以 `page-changed` 收场，而前两步已把消息真发出去了**；
`instructions.ts:51` 的「别重排」口径只覆盖「闸挡下 / 超时 / 页面不在」，**没覆盖
`page-changed`**——模型该重排还是不该，协议没说（**行为未定义**，不是我原先票里写的「必然重试」）。

## What Changes

- `send.page` 从四步缩成**两步**（`composer.type` → `send.enter`），去掉 `wait.reply` 与
  `parseReplyPayload`。它变成「**往页面发一条问题**」这一件，不再承诺读回什么。
- `instructions.ts:49-50` 那段本地工具描述**改成不撒谎**（去掉「等回灌、返回答复正文」），
  并把 `page-changed` 补进 `:51` 的处置口径（模型该重排还是不该，写死）。
- 同步 `local-tools` spec（`send.page` 的契约 / 失败矩阵 / 测试三条）、fixture、
  `localtools.test.ts`、`instructions.test.ts` 的对拍文案。
- **不撤掉 `send.page`**：留着「让页面模型给页面发一条新消息」这个窄能力（无害，前提是
  不再撒谎）。`local-tools` 机制与 ADR-0013 的论证原样保留。
- **另记**：issue #23 的原始需求（「组合工具任何 agent 开箱即用」）**本 change 不解决**——
  ADR-0013 改住扩展侧之后只对围栏里的页面模型生效，agent 仍调不到页面动作。在 ADR-0013
  加一条补记把这件事记下。

## 为什么不选另外两条路

- **C 撤掉 `send.page`**：它是 ADR-0013 的**落空产物**（issue #23 要「agent 开箱即用」，
  而扩展侧本地工具只有页面模型能排，见 ADR-0013:23-24），撤掉在原则上对。但代价不小：
  `local-tools` 9 条 requirement 里大半要动、`instructions.test.ts` 的对拍对象没了，
  而**issue #23 的真需求仍然没满足**（撤了也不解决它）。收益不足。
- **B 拆成「发问题」+「读答复」两个工具**：第二条造一个**模型用不了**的工具（没有页面
  动作面），而且「读回自己的回答」这件事不需要工具——模型的答复走页面正常流程，
  `detect()` 会看见。

## Capabilities

### Modified Capabilities

- `local-tools`：`send.page` 的契约（四步→两步）、失败矩阵（去掉与 `wait.reply` 相关的
  `timeout` / 回灌解不出那几格）、测试要求。
- `conventions`：**不动**（「写新逻辑前先找」与本条无关）。

## Impact

- 代码：`src/lib/localtools.ts`（`sendPageSteps` 两步、删 `replyTextOf`）、
  `src/lib/instructions.ts:50` 的描述、ADR-0013 补记（文档）。
- 测试：`localtools.test.ts`（四步顺序那条改成两步、删三条 `wait.reply` 相关）、
  `instructions.test.ts`（对拍文案）、`reply.test.ts`（`parseReplyPayload` 往返测试留着——
  它还被别处用）。
- fixture：`action.json:386` 的 `wait.reply 成功` 样例**留着**（`wait.reply` 仍是页面动作，
  只是 `send.page` 不再用它），所以 fixture 可能不用改——apply 时以真实引用为准。
- 行为变化：模型排 `send.page` 后**立刻**收到确认，不再等一轮往返；页面那侧的回答照旧走
  正常流程（`detect()` → 排围栏 → `sendCalls`）。
