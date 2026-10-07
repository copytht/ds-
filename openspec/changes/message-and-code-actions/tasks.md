## 1. 真机补存证（ADR-0018 前置，先于任何执行器）

- [ ] 1.1 `scripts/env-up.sh --debug` 起 ds-browser；停在一条有多轮 assistant 回答的会话（人手动切，探针不点站点）
- [ ] 1.2 只读抓一个 assistant 行的工具栏容器 `message.toolbar`（`div.ds-flex` 整段 `outerHTML`）与其中 6 颗按钮各一条：`message.copy` / `message.retry` / `message.like` / `message.dislike` / `message.read` / `message.share`（`row` 写容器、同排 6 颗、第几颗、从 `aria-label="朗读"` 数起；`capturedOn` 写当天）
- [ ] 1.3 抓一个用户行的工具栏 `message.toolbar.user`（2 颗，反例，不编动作名）
- [ ] 1.4 入档 `protocol/evidence/controls.json`（`probe` 都写成只读表达式；工具栏按钮 `live`，行相关的 `state-bound`）；`evidence.test.ts` 与 `test_evidence.py` 绿
- [ ] 1.5 `scripts/page-action.py evidence` 对新条目全绿（`live` 一致 / `state-bound` 可「未比」，不许「过时」）

## 2. 执行器与闸

- [ ] 2.1 新建 `src/lib/controls.ts`：挂载行 / 代码块的取集合与 `index` 解析（非负 / 负数从末尾 / 非整数 `unknown-action` / 越界 `page-changed`）；工具栏定位（恰好 6 颗 + `朗读` 在第 5 位，不符 `page-changed`）；`aria-disabled="true"` 当不可用；8 个动作导出
- [ ] 2.2 `src/lib/action.ts`：8 个动作进 `BACKOFF_GATED_ACTIONS`；`message.retry` 另进 `SPEAK_GATED_ACTIONS`；`action.test.ts` 补退避 / speak 闸用例（含「其余 7 个不被 speak 闸拦」）
- [ ] 2.3 `entrypoints/content.ts`：`ACTION_ROSTER` 加 8 条

## 3. 契约样例与回归用例

- [ ] 3.1 `protocol/fixtures/action.json`：加成功 / 工具栏结构不符 / 越界 / 用户消息行样例
- [ ] 3.2 `src/lib/controls.test.ts`：原件取自存证（`evidenceHtml("message.toolbar")` 等）最小变形造「正常 / 用户行 / 少一颗 / 多一颗 / 朗读不在第 5 位 / aria-disabled / 越界」，覆盖 spec 的 11 个场景；对拍栅栏不红
- [ ] 3.3 `pnpm quality` 绿

## 4. 真机点验（只点可逆、无外部副作用的）

- [ ] 4.1 `message.copy` / `code.copy`：点后读剪贴板核实；**若合成点击写不进剪贴板，停下，改 design / spec 再继续**
- [ ] 4.2 `message.like`：对「探针测试」会话里的测试消息点一次、再点一次复原；记录「第二次是取消还是无事发生」
- [ ] 4.3 越界 / 用户行 / 参数形状错回码正确且不点（读 `page.state` / DOM 核实无副作用）
- [ ] 4.4 **不点**：`message.retry` / `message.dislike` / `message.share` / `message.read` / `code.download`；在票里记为未验证项
- [ ] 4.5 `scripts/page-action.py evidence` 全程未被改坏

## 5. 收尾

- [ ] 5.1 `openspec validate --all --archived --strict` 绿；提交、开 PR（`Refs #66`）、CI 绿后合并、删分支
- [ ] 5.2 #66 评论：8 项已实现，写明未验证项与「header.share / sidebar.search / sidebar.collapse 因无语义锚留候补」；#66 保持 open 或按用户意见处理
