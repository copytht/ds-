# 页面动作 7/8：停止生成 + 新对话

来源：GitHub issue #21（父 issue #15）。目标：补全页面动作名册里最后一组写动作
——`stop.click`（停止生成）与 `chat.new`（开新对话），写法与现有动作清单、契约样例一致，
不碰随部署变的哈希 class。

## Goal

1. **`stop.click`**：在页面**生成中**定位并点中站点自己的「停止生成」控件；找不到回在册的
   `page-changed`，不假装点过了。
2. **`chat.new`**：开一个新对话并反映到页面（url 变化）。确认既有实现满足 #21 验收。

## Background（已核实的现状）

- **`chat.new` 已实现**：
  - 执行器 `src/lib/page.ts:193` `newChat`（认侧栏 `tabindex=0` 且文字为「开启新对话」的条目，
    认不出抛 `PageError(ACTION_ERROR_PAGE_CHANGED)`）。
  - 已注册进名册 `entrypoints/content.ts:201`。
  - 契约样例 `protocol/fixtures/action.json` 的「chat.new 成功」（`:148`）。
  - 已在退避闸 `BACKOFF_GATED_ACTIONS`，`src/lib/action.ts:110-113`。
  - 测试：`src/lib/page.test.ts:235`（命中/认不出）、`src/lib/action.test.ts:432` 与 `:468`。
- **`stop.click` 未实现**：不在 `ACTION_ROSTER`（`entrypoints/content.ts:194-208`）、无执行器、
  fixture 无样例。历史里只是占位：`dsb/actions.py` 曾有 `WRITE_ACTIONS = ("stop.click",)`，
  并明言「还没实现，不进名册」——该文件随 ADR-0011 大砍删除。
- **选择器未确认**是唯一硬缺口：`stop.click` 的控件只在「生成中」出现，真机探针在生成时页面
  主线程吃紧没抓到（ADR-0007 已知缺口、#15 Further Notes、commit `ef515ed` 明说留到下一轮）。
- **外部动作口已废**（ADR-0011）：`/action` `/actions` `/action/result` 与动作流全删，只留
  「两处册子同步」= `protocol/fixtures/action.json` 的 `errorCodes` ↔ `src/lib/action.ts` 的
  `ACTION_ERROR_*`。页面动作名册仍在，但调用方只剩扩展自己（出站与看门狗催办，目前实际只用
  `composer.type` / `send.enter`）。因此本任务**不涉及 dsb 侧名册**，也没有外露探针面
  （`scripts/env-up.sh:204`）。
- 选择器口径（#15）：优先站点设计系统的 `ds-*` class 与语义属性（`role` / `aria-*` /
  `data-*` key），**不用**会随部署变的哈希 class。
- 失败码口径：页面还在但找不到认得的控件 → `page-changed`（`action.json:29`、
  `src/lib/action.ts:67`）。

## Requirements

- R1 实现 `stop.click` 执行器：生成中能定位并点中停止控件；找不到回 `page-changed`。
- R2 把 `stop.click` 注册进内容脚本名册，并在 `protocol/fixtures/action.json` 增加成功样例。
- R3 不碰随部署变的哈希 class；真机确认后停止键与发送键**同元素、同 class**、`aria-label` 为空，
  唯一判别面是圆键里的图标 `path`，故按图标前缀匹配，认不出回 `page-changed`（见 `design.md`）。
- R4 确认 `chat.new` 满足 #21 验收（点击后由站点完成 url 变化），保持既有契约与测试不变。
- R5 在真机「生成中」确认 `stop.click` 选择器：由人配合在 ds-browser 页面控制台跑一段只读
  探测脚本，把停止控件的 DOM 贴回；据此定选择器，并把真实 DOM 落成回归测试的一条用例。

## Acceptance Criteria

- [ ] `stop.click` 在**生成中**能定位并点中停止控件（选择器要在生成中真机确认一次）。
- [ ] `stop.click` 找不到控件时回在册的 `page-changed`（不假装点过）。
- [ ] `chat.new` 点侧栏「开启新对话」后页面反映为新对话（url 变化，真机人工确认一次）。
- [ ] 两个动作都不碰随部署变的哈希 class。
- [ ] `stop.click` 出现在 `ACTION_ROSTER` 与 `protocol/fixtures/action.json`，与现有动作同一套写法；
      两处册子（fixture `errorCodes` ↔ `action.ts` 常量）测试门不红。
- [ ] 真机抓到的停止控件 DOM 成为一条 jsdom 回归用例（防改版静默失配）。
- [ ] `pnpm quality` 全绿。

## Out of Scope

- #23 `send.page`（组合功能）、#30 其余页面控件补全。
- 重新引入外部动作口 / 动作流（ADR-0011 已废，不再造）。
- 多标签页并发、页面动作清单之外的交互。

## Decisions

- **真机确认方式**（用户拍板）：由人配合在页面控制台跑只读探测脚本，不重启浏览器、不碰主
  profile；账号若仍禁言（无法发起生成）则本条验收延后，其余照做。
- 详见 `design.md`（选择器策略、闸门归属）与 `implement.md`（执行顺序、探测脚本、验证命令）。
