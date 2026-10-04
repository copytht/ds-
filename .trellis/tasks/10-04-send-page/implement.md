# 执行计划：send.page（扩展侧本地工具）

## 顺序清单

- [ ] **1** `src/lib/reply.ts`：加 `parseReplyPayload(text): ReplyPayload | null`——`buildReply` 的逆：
  剥首行锚 `agent:` → `decode` 剩余 TOON → 认 `{status:"ok",answer:[{text}]}` / `{status:"error",error}`，
  其余 null。共置测试补往返与坏输入。
- [ ] **2** `src/lib/localtools.ts`（新）+ `src/lib/localtools.test.ts`（新）：本地工具类型、名册、
  `findLocalTool`、`send.page` 组合（四步顺序 / 入参 / 任一步失败即停并原码返回 / `question` 校验 /
  `seconds` 归一 / 回灌解码，解不出回 `page-changed`）。
- [ ] **3** `entrypoints/background.ts`：`sendCall(call, tabId)` 增参；`parseToolCall` 之后加本地名册截获
  （命中 → `runLocalTool`，**不 fetch dsb**）；`onMessage` 传 `tabId`；`runLocalTool` 用 `actionContext()`
  + `runAction` 组 frame（`target = String(tabId)`），包在途角标 / 保活信封里，失败 `applyOutcome`；
  每标签页重入护栏（已在跑 → 回可见提示，不并发）。
- [ ] **4** `src/lib/instructions.ts`：加「本地工具」段（`send.page` 名字 / 参数 / 一句说明 +
  失败可见性口径：被闸挡 / 超时不回灌，当作没排过）；同步 `instructions.test.ts` 黄金值（从实产出回抄）。
- [ ] **5** `docs/adr/0013-local-tools-run-in-the-extension.md`（新）：记 Q1 拍 A、dsb 保持被动、
  外部 agent 通道另议。
- [ ] **6** 文档：`CONTEXT.md` 加词「本地工具」；（如有工具/协议说明页）补 `send.page`。
- [ ] **7** 跑 `pnpm quality`，修到绿。
- [ ] **8**（可选，真机）`bash scripts/env-up.sh` → 真页面排一次 `send.page` 围栏，确认四步走通、回灌拿到答复；
  替人发言闸关着时确认页面**没有**发送、工具回 `disabled`。

## 验证命令

```bash
pnpm test          # vitest（快）
pnpm typecheck     # tsc
pnpm lint          # eslint
pnpm quality       # 全门（含 ruff + pytest）
```

## 复查门（check gate）

- 截获只在 `parseToolCall` 命中本地名册时发生，普通工具路径一字不改（dsb 调用依旧）。
- 组合**不自己转发**模型围栏（避免双执行）；组合只做 `composer.type` / `send.enter` / `wait.fence` / `wait.reply`。
- 失败码全在册，不新增；失败不进对话流的口径与现有 `isInjectableReply` 一致。
- `instructions.test.ts` 黄金值与实产一致（本地工具段在）。
- `pnpm quality` 全绿。
