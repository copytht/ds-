# 执行计划：wait.* 新行判据改认 |key|（#37）

## 顺序清单（已执行）

- [x] **1** `src/lib/wait.ts`：基线改记 **key 集合**（原样、带符号）+ 无 key 行的**正文集合**；
  判新只认「基线里没见过」的那条。`wait.*` 等挂载（`viewWithin`，预算内轮询，耗尽 →
  `page-changed`）。原计划的 `|key|` 高水位**真机证伪**（同来回两条同值不同号）→ 换集合。
- [x] **2** `src/lib/messages.ts`：行锚两条并列（`[data-virtual-list-item-key], .ds-virtual-list-visible-items > *`）；
  加角色无关的 `rowText`；`textOf` 把新版渲染成代码块的 ```send **还原回围栏文本**。
- [x] **3** `src/lib/fence.ts`：收拢 `parseToolCall` / `MALFORMED_CALL_HINT`（读 DOM 那半边也要用）；
  `relay.ts` 转出。
- [x] **4** `src/lib/wait.test.ts` / `messages.test.ts`：带符号 key 集合、无 key 行、晚挂载、
  始终无列表、代码块围栏等用例。`pnpm quality` 全绿（434 vitest + 138 pytest）。
- [x] **5** 真机（随机延迟）：`send.page` 四步收口回 **`status: "ok"` + 答复正文**。
- [x] **6** spec：新增 `frontend/site-dom-anchors.md`（锚点契约 + 判新口径）；`#37` 回帖复验结论。

## 验证命令

```bash
pnpm test          # vitest（快）
pnpm typecheck
pnpm lint
pnpm quality       # 全门
```

## 复查门（check gate）

- 判新只用 `|key|` 高水位；不再出现裸 `key > baseline`。
- 「等挂载」的预算与 `parseWaitSeconds` 同一口径；失败码仍是册子里的 `page-changed` / `timeout`。
- 旧行（`|key| ≤ 基线`）不被误认成新消息。
- `pnpm quality` 全绿；真机 send.page 四步收口拿到 `ok`。
