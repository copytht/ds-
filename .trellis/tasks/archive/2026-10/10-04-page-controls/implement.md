# 执行计划：页面控件补全（v1 = 两个 composer 开关）

## 顺序清单

- [x] **1** `src/lib/page.ts`：加 `TOGGLE_SELECTOR` / `THINK_LABEL` / `SEARCH_LABEL`、
  `findToggle(label)`、`readThink` / `setThink` / `readSearch` / `setSearch`。
  失败走 `PageError`：找不到 → `page-changed`；`set` 参数非布尔 → `unknown-action`。
- [x] **2** `entrypoints/content.ts`：import 四个执行器，`ACTION_ROSTER` 加 4 项。
- [x] **3** `src/lib/action.ts`：`BACKOFF_GATED_ACTIONS` 加 `think.set` / `search.set`，
  并把注释里的「新增写动作要记进来」对齐。
- [x] **4** `protocol/fixtures/action.json`：加 4 条成功样例（`think.get` / `think.set` /
  `search.get` / `search.set`），与现有样例同写法。
- [x] **5** `docs/page-actions.md`：候补控件登记表（含 v1 / 只登记 / 待查）。
- [x] **6** `src/lib/page.test.ts`：新增开关执行器测试（读 / 写 / 幂等 / 找不到 / 参数形状）。
- [x] **7** `src/lib/action.test.ts`：退避闸覆盖两个 `set`；确认 `SPEAK_GATED_ACTIONS` 不含它们。
- [x] **8** 跑 `pnpm quality`，修到绿。
- [x] **9**（可选，真机）`bash scripts/env-up.sh` 重建产物 → 在真页面确认
  `div.ds-toggle-button` / `aria-pressed` / 文字；确认结果回写 `docs/page-actions.md` 的「已确认」标记。

## 验证命令

```bash
pnpm test          # vitest（快）
pnpm typecheck     # tsc
pnpm lint          # eslint
pnpm quality       # 全门（含 ruff + pytest）
```

## 复查门（check gate）

- 名册新增动作 ↔ `action.json` 样例一致、写法与既有样例同形。
- 没有把「只登记」的控件写进 `ACTION_ROSTER`（否则点下去回 `unknown-action` 的假实现）。
- 写动作确实记进 `BACKOFF_GATED_ACTIONS`；没误进 `SPEAK_GATED_ACTIONS`。
- 选择器只用 `ds-*` / `aria-*`，没有哈希 class。
- `page-changed` / `unknown-action` 复用既有码，未新增失败码。

## 回滚点

- 每个提交是一步；`git revert` 单步即可。整任务回滚 = revert 全部本任务提交。

## 待确认（实现时定）

- 真机文字 / class 与 issue 描述若有出入，以真机为准，并在 `docs/page-actions.md` 记录。
