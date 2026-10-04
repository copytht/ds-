# 设计：组合功能 send.page（扩展侧本地工具）

## 决定与边界

- **Q1 = A（已拍板）**：组合住在**扩展侧 background**；网页模型排 `send.page` 围栏时，
  扩展**就地执行**，不把这一条转发 dsb。dsb 零改动，守 ADR-0011（dsb 是被动 MCP 网关：
  只能被调，不能反过来指挥扩展）。
- 两条现有链路不动：普通工具围栏 `content → background → dsb /mcp → 回灌`；
  页面动作 `background → content 名册`。本任务只**新增一个入口**：围栏里出现本地工具名时，
  在 background 截获、本地执行。
- **不是**给外部 MCP 客户端开页面动作通道（Out of Scope）：那要重开双向通道，是另一件事。

## 术语

- **本地工具**：名字在扩展自己的一张名册里、执行不经过 dsb 的围栏工具。v1 只有 `send.page`。
- **组合（composite）**：由多件既有页面动作串起来、对外表现为一个工具。

## 数据流：一次 `send.page`

```
网页模型排 {"tool":"send.page","arguments":{"question":"X"}}
   │  （```send 围栏，页面世界 → content → background）
   ▼
background.onMessage: parseSendRequest → sendCall(call, tabId)
   │  parseToolCall → tool = "send.page"
   │  findLocalTool("send.page") 命中 → 本地执行（不 fetch dsb）
   ▼
send.page.run(question, {tabId, run}):
   1. run("composer.type", {text: X})   ← 走 runAction：总开关 / 替人发言 / 退避 三道闸
   2. run("send.enter", {})             ← 同上
   3. run("wait.fence", {timeout: n})   ← 等页面模型排出下一条 ```send 围栏
   4. run("wait.reply", {timeout: n})   ← 等那条围栏的回灌落地
   5. parseReplyPayload(回灌文本) → ok → okPayload(答复正文)
   ▼
ReplyPayload 原路回 content → 页面世界（inject 侧 buildReply 组装 `agent:` 回灌）
```

**关键点：不重复执行。** 模型在步骤 3 排出的那条围栏，由**既有的普通路径**（content →
background.onMessage → sendCall）独立转发给 dsb 并回灌；组合**只等、不转发**。
组合的步骤 4 等的正是那条普通路径写回的 `agent:` 行。

## 模块与接口

### 新模块 `src/lib/localtools.ts`（纯逻辑，可单测）

```ts
export type LocalToolEnv = {
  /** 围栏来自哪个标签页；消息不带 tab 时 undefined。 */
  readonly tabId: number | undefined;
  /** 送一件页面动作：background 注入的 runAction 包装（已带闸与 target）。 */
  readonly run: (action: string, params: Record<string, unknown>) => Promise<ActionOutcome>;
};

export type LocalTool = {
  readonly name: string;              // "send.page"
  readonly description: string;       // 一句话，进协议说明
  readonly params: readonly string[]; // ["question", "seconds?"]
  readonly run: (args: Record<string, unknown>, env: LocalToolEnv) => Promise<ReplyPayload>;
};

export const LOCAL_TOOLS: readonly LocalTool[];
export function findLocalTool(name: string): LocalTool | null;
```

`send.page.run` 的行为：

1. `tabId === undefined` → `errorPayload(ACTION_ERROR_TAB_GONE)`。
2. `question` 必须是**非空字符串**，否则 → `errorPayload(ACTION_ERROR_UNKNOWN)`（排得不成形）。
3. `seconds` 归一到 `wait.ts` 口径（缺省 25、钳 1..25），传给两次等待的 `timeout`。
4. 依次 `run(...)` 四步；任何一步 `ok:false` → 原码 `errorPayload(outcome.error)`，**不再往下**。
5. 步骤 4 成功 → `parseReplyPayload(outcome.result.text)`；解不出 →
   `errorPayload(ACTION_ERROR_PAGE_CHANGED)`；ok → `okPayload(answers.join("\n"))`；
   error → `errorPayload(payload.error)`。

### `src/lib/reply.ts` 增 `parseReplyPayload`

`buildReply` 的逆：剥首行锚 `agent:` → `decode` 剩余 TOON → 认 `{status:"ok", answer:[{text}]}` /
`{status:"error", error}`，其余 null。`buildReply`/`parseReplyPayload` 往返有测试。

### 截获点 `entrypoints/background.ts`

- `sendCall(call, tabId)` 增参；在 `parseToolCall` 之后、`fetch` 之前：

  ```ts
  const local = findLocalTool(toolCall.tool);
  if (local !== null) return runLocalTool(local, toolCall.arguments, tabId);
  ```

- `runLocalTool`：`actionContext()` 拿 `ActionContext`，`run = (action, params) =>
  runAction(frame(action, params), context)`（`frame.target = String(tabId)`）；
  包在与 `sendCall` 同在途的角标/保活信封里（`setInFlight(true)` + `keepAliveWhileSending()`），
  失败也 `applyOutcome` 留痕。
- `onMessage` 把 `tabId`（`sender.tab?.id`）传进 `sendCall`。
- **重入护栏**：`Map<number, boolean>` 记「该标签页有本地工具在跑」；已在跑时新来的本地工具
  回一个 `okPayload`（可见提示、让模型别重排），**不并发跑第二个**。

### 协议说明 `src/lib/instructions.ts`

- 在工具目录段之前加一段**本地工具**（静态，不随 dsb 目录变）：

  ```
  - 另有扩展自带的本地工具（不占网关目录，排了就地执行）：
    - send.page(question, seconds?) — 往页面发一个问题，等页面模型排围栏、等回灌，返回答复正文。
  ```

- 黄金值测试 `instructions.test.ts` 同步（从实产出回抄）。
- **失败可见性口径**（写进说明）：本地工具被闸挡 / 超时 / 页面不在时不回灌；与
  「网关没连上」同一处置——当作没排过、不重排。

## 闸与失败码

- 四步全走 `runAction`，三道闸天然生效：
  - 总开关关 → 第 1 步回 `disabled`；
  - 替人发言闸关（`SPEAK_GATED_ACTIONS` 含 `composer.type`/`send.enter`）→ 回 `disabled`；
    **这一步挡住了，页面不发送**（issue AC）；
  - 退避中（`BACKOFF_GATED_ACTIONS`）→ 回 `backing-off`。
- 失败码全取现成册子：`disabled` / `backing-off` / `tab-gone` / `composer-absent` /
  `page-changed` / `timeout` / `unknown-action`。**不新增码**。
- 失败以 `errorPayload(code)` 返回 → 不进对话流（与 dsb 传输/闸失败同一口径，`isInjectableReply` 挡）。
  扩展侧 `applyOutcome` 留痕、图标可看。

## 超时与预算

- 两次等待各用 `seconds`（缺省 25、钳 1..25）；组合最坏约 50s。
- 本地路径**不占** dsb 的 30s 锁（没有 fetch），所以比 25+25 更长也不会被折成中继 timeout。
- 浏览器 runtime 消息无超时：`sendResponseMessage` 会等组合跑完再回。

## 兼容与回滚

- 纯新增：dsb、`protocol/fixtures/action.json`、页面动作 `ACTION_ROSTER` 都不动。
- 回滚 = 让 `findLocalTool` 恒 null（或去掉截获段）→ 回到「围栏只转发 dsb」。
- 新增一篇 ADR 记「本地工具住扩展侧、dsb 保持被动」：`docs/adr/0013-local-tools-run-in-the-extension.md`。

## 测试策略

- `src/lib/localtools.test.ts`：名册查找；`send.page` 四步顺序与入参；任一步失败即停并原码返回；
  `question` 非法；`seconds` 归一（越界钳、缺省）；回灌解出正文；解不出回 `page-changed`。
- `src/lib/reply.test.ts`：`parseReplyPayload` 与 `buildReply` 往返；坏输入回 null。
- `src/lib/instructions.test.ts`：黄金值含本地工具段。
- `background` 不单测（接线层），靠 `pnpm quality` + 真机 `scripts/page-action.py` 验。

## 已知风险

- **围栏竞态**：步骤 3 `wait.fence` 的基线在它启动时取；若模型快到在该动作到达前就排出围栏，
  会漏计成 `timeout`。真机上模型响应远超一次动作往返，风险低；先记录，不为此改 `wait.ts` 口径。
- **重入**：模型回答子问题时再排 `send.page`。用每标签页护栏挡第二个（可见提示）。
- **语义假设**：`send.page` 预设「模型会排一条围栏」；若模型直接口语作答（不排围栏），
  步骤 3 会 `timeout`。这是 issue 明列的四步口径，不改。
