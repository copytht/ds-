## 1. 真机补存证（ADR-0018 前置，先于执行器）

- [ ] 1.1 `scripts/env-up.sh --debug` 起 ds-browser；侧栏当前是收起态（用户已手动收起）——先只读抓**收起态**：`sidebar.topbar.collapsed`（顶栏按钮的父容器整段 `outerHTML`，spacer + 3 颗）与 `sidebar.toggle.collapsed`（第 1 颗开关键）
- [ ] 1.2 展开态存证要等执行器能展开之后补（见 3.2），这里先把收起态入档 `protocol/evidence/controls.json`（`state-bound`；`probe` 写成只读表达式，用「开启新对话」锚回溯，不用哈希 class）；对拍测试绿

## 2. 执行器与闸

- [ ] 2.1 `src/lib/page.ts`：把 `setToggleOption` 里「点完轮询到目标态」抽成共用小函数（读函数 + 目标态 + 上限 → 达成态），开关改用它，行为不变（现有测试全绿）
- [ ] 2.2 `src/lib/page.ts`：`readSidebar`（锚「开启新对话」的布局盒 → `{collapsed}`）与 `setSidebar`（`{collapsed}` 非布尔 `unknown-action`；已在目标态不点不轮询；找顶栏图标键并三重校验：数量 / 位置 / 同属一个父元素，不符 `page-changed`；点完轮询）
- [ ] 2.3 `src/lib/action.ts`：`BACKOFF_GATED_ACTIONS` 加 `sidebar.set`（不进 speak 闸）；`action.test.ts` 补退避 / speak 闸用例
- [ ] 2.4 `entrypoints/content.ts`：`ACTION_ROSTER` 加 `sidebar.get` / `sidebar.set`

## 3. 真机先验最大的风险，再补测试

- [ ] 3.1 真机 `send sidebar.get` 回 `{collapsed:true}`（与用户已收起的事实一致）；`send sidebar.set {"collapsed":false}` 展开，`sidebar.get` 回 `false`，且 `chats.list` 数量没变（没误点成新对话）
- [ ] 3.2 展开态下只读抓 `sidebar.topbar.expanded` 与 `sidebar.toggle.expanded` 存证入档；`send sidebar.set {"collapsed":true}` 收起，两个方向各来回一次，记录实际耗时
- [ ] 3.3 **若合成点击无效或点到别的键**：停下，改 design / spec，不硬上
- [ ] 3.4 `protocol/fixtures/action.json`：加 `sidebar.get 成功`、`sidebar.set 成功`、`sidebar.set 顶栏结构对不上`、`sidebar.set 参数不是布尔`
- [ ] 3.5 `src/lib/page.test.ts`：原件取自存证，覆盖 spec 的 10 个场景（含数量 / 位置 / 不同属一个父元素 / 异步生效 / 站点拒绝；jsdom 里 `getClientRects` 要 stub）；对拍栅栏不红
- [ ] 3.6 `pnpm quality` 绿

## 4. 收尾

- [ ] 4.1 `scripts/page-action.py evidence` 新增条目全绿或「未比」，无「过时」
- [ ] 4.2 `openspec validate --all --archived --strict` 绿；提交、开 PR（`Refs #66`）、CI 绿后合并、删分支
- [ ] 4.3 #66 评论：`sidebar.get/set` 已实现；`sidebar.search` / `header.share` 仍留候补
- [ ] 4.4 归档本 change（delta 同步进 `frontend` 主 spec）
