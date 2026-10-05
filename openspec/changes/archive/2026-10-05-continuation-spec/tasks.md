# Tasks

## 1. 校验

- [x] 1.1 `openspec validate "continuation-spec" --strict` 过。
      验证：命令输出 `Change 'continuation-spec' is valid`。
- [x] 1.2 `openspec validate --all --strict` 过（新能力尚未 archive，`--all` 要认它）。
      验证：`Totals: N passed, 0 failed`。
- [x] 1.3 逐条核对 requirement 与代码一致（每条至少一个证据行号）：- 正文走请求体 → `entrypoints/inject.content.ts:101-122`（`rewriteOutgoing` 一消费即作废）
      与 `src/lib/inject.ts` 的 `rewriteContinuationBody` - 武装在放行那一刻 → `inject.content.ts:144-151`（`flush` 里的 `isContinuation` 分支）- 出站窗口 3–5 秒 → `src/lib/outbound.ts:6-7`（`WINDOW_MIN_MS` / `WINDOW_MAX_MS`），
      且首条也要等满 → `src/lib/gate.test.ts:66-71` - 8 轮刹车 / 归零两处 → `src/lib/rounds.ts:15,39-42,48-50`，
      归零触发点 → `inject.content.ts:210-213`（换会话）与 `:228-229`（答复无围栏）- 2000 字截断 → `src/lib/continuation.ts:26,32-35` - 失败不重试/不留半截 → `inject.content.ts:101-122,152-170,402-419` - 「结果没到手上 ≠ 中继没连上」→ ADR-0014 `:46-47` + ADR-0010 - 催办受 speak / 续聊不受 → `src/lib/action.ts:236` 与 ADR-0014 `:44-45`
      验证：每条都能指到具体行；指不到的改 requirement 或改代码。

## 2. 文档里被这条 spec 取代的断言（只改被取代的部分）

- [x] 2.1 `CONTEXT.md:89-91` 的「唯一出站口」词条：**不加新说法**，但要在词条里指向
      `continuation` 能力（本 change 已把收口范围写窄）。验证：`openspec show continuation` 的
      「出站窗口是自动续聊这一路的收口」与词条不冲突。
- [x] 2.2 不改 `docs/adr/*` 的**决定**（ADR-0002 的窗口仍只管续聊，那是对的）。
      注：执行中发现 ADR-0002:15「唯一的发送路径」这句**本身已被 #48 证伪**，另见 2.4。
- [x] 2.3 `openspec/specs/conventions/spec.md:14` 那句「发消息到页面 → 唯一出站口 `gate.ts`」
      收窄（它是唯一直接矛盾于新 `continuation` spec 的 requirement）。新增
      `specs/conventions/spec.md` 的 MODIFIED delta：把「发消息」按**哪一条路**分（续聊 →
      `gate.ts` + 窗口；手动/催办 → `runAction` + 两道闸），并加一条场景讲清「别因为都是
      发消息就当同一条路——#48 就是这么长出第二条路的」。
      验证：`openspec validate "continuation-spec" --strict` 过（MODIFIED 的 requirement 名
      一字不差）；archive 后 `conventions` spec 里那句不再断言「唯一」。
- [x] 2.4 ADR-0002 加一条 2026-10-05 补记：「『唯一的发送路径』只对自动续聊成立」——照
      `:18` 那条 2026-10-03 补记的既有做法（ADR 记录历史与教训，spec 管约束）。
      验证：`docs/adr/0002-outbound-through-a-single-gate.md:15` 的原句被补记接住，两处不再
      互相矛盾；`pnpm quality` 仍绿。

## 3. 门

- [x] 3.1 `pnpm quality` 全绿（**本 change 不改代码**，所以这里只是确认没碰坏东西）。
      验证：退出码 0、测试数与 main 相同（496 vitest + 143 pytest）。
- [x] 3.2 明确记一笔：**#47 仍未修**（`send.page` 每次仍 `page-changed`）。
      验证：PR 描述与 issue #47 的评论里都写明「规格已补，修法待拍板」。

## 4. archive

- [x] 4.1 `/opsx-archive continuation-spec`：`continuation` 主 spec 从 ADDED 生成（新建，
      带 `## Purpose`），`local-tools`「`send.page` 的契约」与 `conventions`「写新逻辑前先找」
      两条 MODIFIED 整块替换（保留原场景名「成功」「失败」「想写一个新 parse / 一个新信封」，
      分别新增「缩写口径」「要发消息到页面」）。验证：archive 后 `openspec validate --all
    --strict` 6 passed 与 `--all --archived --strict` 4 passed 都过；无 delta 头残留。

## 回滚点

- 纯文档（spec）改动，回滚= `git revert`；代码零改动，无运行时风险。
- `local-tools` 那条注记若被误读成「已修」，回滚本 change 会让注记消失——那时 #47 的现状
  仍在票里，不会被静默。
