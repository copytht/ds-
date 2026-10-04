# 页面控件补全：把页面上其余按钮也标成动作

来源：GitHub issue #30。这些控件**不在** spec #15 的 15 个最小单元里——本任务把它们
按同一套写法登记进页面动作体系：能稳妥落地的进 v1 并实现，拿不准用途的先标「待查」，只登记不硬编。

## Goal

1. 把 #30 的候补控件逐条登记：动作名、**稳妥的定位方式**（优先 `ds-*` / `role` / `aria-*`，
   不碰随部署变的哈希 class）、返回形状、状态（进 v1 / 只登记 / 待查）。
2. 明确**哪些进 v1**（实现 + 契约样例 + 测试），哪些只登记。
3. 与现有动作名册（`entrypoints/content.ts` 的 `ACTION_ROSTER`）和契约样例
   （`protocol/fixtures/action.json`）同一套写法。

## Background（已核实的现状）

- 页面动作的执行器在 `entrypoints/content.ts:194` 的 `ACTION_ROSTER`；执行逻辑在
  `src/lib/page.ts`；契约样例在 `protocol/fixtures/action.json`。
- 动作没有外来推送面了（ADR-0011）：调用方只剩扩展自己（出站 / 看门狗），每跳当场回
  一个册子里的码（`src/lib/action.ts` 的 `ACTION_ERROR_*`）。
- 名册里**没实现的动作**由收信那层回 `unknown-action`——所以「登记」与「实现」必须分开：
  只登记的控件**不写进 `ACTION_ROSTER`**，避免造出「名册有、点了没反应」的假实现。
- **两处册子必须同步**（ADR-0011）：`protocol/fixtures/action.json` 的 `errorCodes` ↔
  `src/lib/action.ts` 的 `ACTION_ERROR_*`。本任务只加动作样例、不加失败码，除非确有必要。
- 闸：写动作受「代你发言」闸（`SPEAK_GATED_ACTIONS`）与退避闸（`BACKOFF_GATED_ACTIONS`）管；
  新增**会改页面状态**的动作要记进退避闸名单（`src/lib/action.ts:107-113` 明说）。
- 失败码口径：页面在但找不到认得的控件 → `page-changed`；写作框不在 → `composer-absent`。

## 候补控件（真机爬到的清单，来自 #30）

1. **深度思考 / 智能搜索 两个开关**：`div.ds-toggle-button`，状态看 `aria-pressed`；
   按文字（`深度思考` / `智能搜索`）认，文字本地化要留意。
2. **每条 assistant 消息的工具栏**：复制 / 重试 / 点赞 / 点踩 / **朗读**（唯一带
   `aria-label` 的那个）/ 分享（或「更多」）。
3. **代码块上的** 复制 / 下载。
4. **附件上传**：发送键左边那个 `div[role=button].ds-button--iconLabelPrimary…`，
   背后有隐藏的 `input[type=file][multiple]`。
5. **模型选择 / 会话页头右上那两个小图标**：用途还没认出来 → **待查**。

## Requirements

- **R1** 每个候补控件有一条登记：动作名、稳妥定位方式、返回形状、状态。
- **R2** 拿不准用途的（模型选择、页头小图标）**只标「待查」**，不硬编、不猜。
- **R3** 写清哪些进 v1、哪些只登记；只登记的不进 `ACTION_ROSTER`。
- **R4** v1 的动作：执行器（`src/lib/page.ts`）+ 名册（`content.ts`）+ vitest
  （`page.test.ts` / `action.test.ts` 视改动面）+ 契约样例（`action.json`）四件齐；写法与现有动作一致。
- **R5** 只登记的清单要有**落点**（别丢），且与现有册子口径一致、不进 lint/format 的生成物。
- **R6** 不碰站点哈希 class；不新增失败码（除非确实需要，且两处同步）。

## Acceptance Criteria

- [ ] #30 清单里每个控件都有登记项：动作名 / 定位方式 / 返回形状 / 状态。
- [ ] v1 子集实现完整：名册 + 执行器 + vitest + `action.json` 样例。
- [ ] 待查项明确标注，代码里没有硬编的假实现。
- [ ] `pnpm quality` 绿。

## Out of Scope

- #15 的 15 个最小单元（已实现）。
- CDP 外挂那条路（#15 明确不做）。
- 多标签页并发。

## Notes

- 待定：v1 子集范围（见下方 Scope 决策）。
- 真机确认：本任务的选择器若要走真机验证，先 `bash scripts/env-up.sh`（会重建产物；
  必要时按 AGENTS.md 例外重启 ds-browser）。
