# Tasks

## 1. 合并实现（含测试）

- [x] 1.1 `button.get`（读）：`page.ts` 里 `circleIconPath()` + 图标前缀挪成读面
      （`STOP_ICON_PREFIX` → 一处一对：箭头 = send、方块 = stop，认不出 = `unknown`）；
      圆键不在 → `page-changed`。测试（复用 `page.test.ts` 已有的真机 `SEND_BUTTON_HTML` /
      `STOP_BUTTON_HTML`）：箭头 → `pressed: "send"`；方块 → `pressed: "stop"`；图标换成
      第三种 path → `pressed: "unknown"`（**成功返回，不抛**）；键不在 → 抛 `page-changed`。
- [x] 1.2 `button.click`（写）：删 `findStopButton` / `stopClick` / `STOP_SELECTOR` 兜底；
      `findSendButton` → `findButton`（只判「在 + 可用」，**不含图标**），`clickSend` →
      `buttonClick`（返回 `{}`）。测试：方块态**照点**（这条是合并的语义，别写反）、箭头态照点、
      `ds-button--disabled` 不点、没渲染盒子不点。
- [x] 1.3 名册与闸：`entrypoints/content.ts` 的 `ACTION_ROSTER` 两条换两条
      （`button.get` / `button.click`）；`action.ts` 的 `SPEAK_GATED_ACTIONS`（`send.click` →
      `button.click`）与 `BACKOFF_GATED_ACTIONS`（去掉 `stop.click`）；
      `action.test.ts` 那条 stop.click 闸用例改成 `button.click`；**加一条断言**：`button.get`
      不在任一闸里（读动作不受闸）。

## 2. 契约与文档

- [x] 2.1 `protocol/fixtures/action.json`：删 `stop.click 成功` 与 `send.click 成功`，
      合成 `button.click 成功`（返回 `{}`）+ 新增 `button.get 成功`（`pressed: "send"`）与
      `button.get 图标认不出`（`pressed: "unknown"`）。
- [x] 2.2 `README.md:71` 的例子 `send stop.click` → `get button.get` / `send button.click`。
- [x] 2.3 真机 DOM 抓取补进 `src/lib/page.test.ts` 常量区（思考期 spinner，1.2 那条门要用）。

## 3. 门

- [x] 3.1 `pnpm quality` 全绿；`openspec validate --all --strict` 过。验证：退出码 0。
- [x] 3.2 真机（限速、`chat.deepseek.com` 标签页在前台）：① `button.get` 空闲态 → `send`、
      生成中 → `stop`；② `button.click` 空闲态（输入框有内容）→ 消息真发出；③ 生成中 `button.click`
      → 生成被打断（这正是合并的语义：点 = 停）；④ **思考期点它**：spinner 带不带
      `ds-button--disabled`？带 → 回 `page-changed`（设计预期）；不带 → 实测点下去的后果，
      按结论决定要不要给 `button.click` 补判据，并把真机 DOM 落成回归常量（tasks 2.3）。
- [x] 3.3 票：**#32** 关闭（`send.click` 已不存在，问题不复存在）；**#21** 补记合并
      （`stop.click` 并入 `button.click`，实现与 requirement 退役）。

## 回滚点

- 合并本身可回退到 `send.click` + `stop.click` 两动作版本（git revert），但那会把
  「两个动作对同一元素给出矛盾判断」请回来——#32 的坑原样复发。
- `button.get` 的图标口径独立：站点换图标只会让它少报一种值，不影响 `button.click`。
