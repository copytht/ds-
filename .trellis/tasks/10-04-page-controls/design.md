# 技术设计：页面控件补全（v1 = 两个 composer 开关）

## 边界

- 只动**扩展层**：`src/lib/page.ts`、`entrypoints/content.ts`、`src/lib/action.ts`、
  `protocol/fixtures/action.json`、同名测试、`docs/page-actions.md`。
- **不动 dsb**（ADR-0011 后页面动作没有中继侧名册）。
- v1 只实现「深度思考 / 智能搜索」两个开关；其余候补只登记。
- **不新增失败码**（沿用 `page-changed` / `unknown-action`）。

## 动作契约（v1）

| 动作名 | 类型 | params | 成功 result | 失败 |
| --- | --- | --- | --- | --- |
| `think.get` | 读 | `{}` | `{ enabled: boolean }` | `page-changed`（找不到控件） |
| `think.set` | 写 | `{ enabled: boolean }` | `{ enabled: boolean }`（达成态） | `page-changed`；`enabled` 非布尔 → `unknown-action` |
| `search.get` | 读 | `{}` | `{ enabled: boolean }` | `page-changed` |
| `search.set` | 写 | `{ enabled: boolean }` | `{ enabled: boolean }`（达成态） | 同 `think.set` |

**命名理由**：`think` = 深度思考、`search` = 智能搜索；点分 `域.动词`，与
`composer.*` / `send.*` / `messages.*` / `wait.*` 同风格。动词 `get`/`set` 与主开关
`toggle.get`/`toggle.set` 对齐，域前缀消歧义。

## 定位与状态（选择器口径）

- 选择器 `div.ds-toggle-button`——站点设计系统的 class，**非哈希**。
- 按**文字**认控件：`textContent.trim()` 严格等于 `深度思考` / `智能搜索`。
  本地化风险已知：只认中文；站点换语言 → 找不到 → `page-changed`（**不猜**）。
- 状态读 `aria-pressed`：`"true"` → `enabled = true`。
- `set` **幂等**：读当前态 == 目标态则不点；否则 `el.click()`，点完再读一次回
  **达成态**（点完可能被站点拒/异步，回达成态比回目标态诚实）。

## 代码落点

- `src/lib/page.ts`：
  - `TOGGLE_SELECTOR = "div.ds-toggle-button"`、`THINK_LABEL = "深度思考"`、
    `SEARCH_LABEL = "智能搜索"`。
  - `findToggle(label): HTMLElement | null`——遍历 `TOGGLE_SELECTOR`，trim 文字相等。
  - `readToggleOutcome(label, frame): { enabled: boolean }`、`setToggleOutcome(label, frame)`。
  - 导出 `readThink` / `setThink` / `readSearch` / `setSearch` 四个薄函数（进名册）。
- `entrypoints/content.ts`：`ACTION_ROSTER` 加 4 项。
- `src/lib/action.ts`：`BACKOFF_GATED_ACTIONS` 加 `think.set`、`search.set`（写动作改页面状态）。
  **不进** `SPEAK_GATED_ACTIONS`（不代你发言）。
- `protocol/fixtures/action.json`：加 4 条成功样例。

## 只登记清单落点

`docs/page-actions.md`——表格列全部候补控件：控件 / 建议动作名 / 定位 / 返回形状 / 状态
（v1 / 只登记 / 待查）。v1 两条开关指向已实现的动作；其余登记不实现。

## 测试

- `src/lib/page.test.ts` 新增 describe：
  - `get`：`aria-pressed="true"` → `{enabled:true}`；`"false"` → `{enabled:false}`；
    找不到 / 文字不匹配 → `PageError(page-changed)`。
  - `set`：目标 ≠ 当前 → `click()` 被调用、回**达成态**；目标 == 当前 → **不 click**。
  - `set`：`enabled` 非布尔 → `PageError(unknown-action)`。
  - 定位：只认 `div.ds-toggle-button`；文字前后空白可容忍。
- `src/lib/action.test.ts`：退避闸覆盖 `think.set`/`search.set`（禁言中回 `backing-off`）；
  `think.get`/`search.get` 不受退避影响。
- fixture 自洽由既有 `fixtures.test.ts` / `tests/test_fixtures.py` 兜（结构不变，只在 `cases` 加项）。

## 兼容与回滚

- 纯**加**动作：不动现有动作、失败码、存储键、线协议 → 向后兼容。
- 回滚 = revert 本次提交。

## 取舍

- **为什么 `get`/`set` 分开、不做单个 `toggle`**：调用方（出站 / 看门狗）要能先读到状态，
  且 `set` 幂等；与主开关 `toggle.get/set` 一致。
- **为什么 v1 不做消息工具栏 / 代码块 / 附件**：三者都要「按消息或代码块索引」，
  附件还要文件数据，改动面与风险都大——先登记（`docs/page-actions.md`）。
