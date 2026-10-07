## 1. 存证文件与加载

- [x] 1.1 建 `protocol/evidence/controls.json`：顶层 `description` + `entries` 数组，条目形状见 design 决定 1
- [x] 1.2 把 `page.test.ts` 里三份圆键常量原样搬成 `circle.stop` / `circle.send` / `circle.spinner` 三条（`reconcile: state-bound`，日期取原注释），并为每条写 `probe`
- [x] 1.3 写 `src/lib/evidence.ts`：读存证、按 id 取（`evidenceHtml(id)`）、导出类型；不碰 console、不碰站点
- [x] 1.4 `src/lib/page.test.ts` 的圆键用例改成 `evidenceHtml(...)` 取原件；用例全绿，且字符串常量里不再出现整条 `path`

## 2. CI 对拍

- [x] 2.1 `src/lib/evidence.test.ts`：完整性（字段齐、`capturedOn` 合法、无省略占位、jsdom 解析的 `svg` 与 `svgs` 逐项相等、id 唯一、tag 成对）
- [x] 2.2 `src/lib/evidence.test.ts`：扫 `src/**/*.test.ts` 源码，出现任何存证 `path` 的 `d` 整条原文就红（存证自己不算）；先临时手抄一条确认它真会红，再还原
- [x] 2.3 `tests/test_evidence.py`：用标准库 `html.parser` 独立实现 2.1 的同一判据；缺一个字段的坏条目要红（造一个确认）
- [x] 2.4 确认 `fixtures.test.ts` / `test_fixtures.py` 的 `EXPECTED_FILES` 不受影响（存证不在 `protocol/fixtures/`）

## 3. 真机重抓代码块并回补

- [x] 3.1 `scripts/env-up.sh --debug` 起 ds-browser；找一条含代码块的会话（已登录、未禁言），只读抓 `code.block` / `code.copy` / `code.download` 的 `outerHTML` 与 `svg`
- [x] 3.2 三条入档 `controls.json`（`live`；`code.copy` / `code.download` 的 `row` 写明父容器、同排 2 颗、第几颗），日期写当天
- [x] 3.3 `messages.test.ts` 第 141 行起的缩写 fixture 改成 `evidenceHtml("code.block")` 的真实结构；断言「表头与复制/下载是 `<pre>` 的兄弟、不算正文」仍成立
- [x] 3.4 （未触发：3.3 在真实结构下仍绿，`readRow` 成立）若 3.3 在真实结构下红：停下，把现象记进票（缺陷另开），不在本 change 里改 `readRow`

## 4. 真机对账子命令

- [x] 4.1 `scripts/page-action.py` 加 `evidence [--id <id>]`：读 `controls.json`，对 `live` 条目跑 `probe` 逐字比；不等打印 id + 差异片段 + 「站点改版，存证过时」、退出码 1；`state-bound` 不等只报「当前态不符、未比」；沿用 `pace()`、只读不 dispatch
- [x] 4.2 更新脚本顶部用法文档与 `--help`
- [x] 4.3 真机跑一遍 `evidence`：`code.*` 三条应全绿；再改坏本地一份存证的一个字符，确认它报「存证过时」后还原

## 5. 验收与提交

- [x] 5.1 `openspec validate --all --archived --strict` 绿
- [x] 5.2 `pnpm quality` 绿
- [ ] 5.3 提交、开 PR（`Refs #66`，**不写 Fixes**，#66 还剩 11 项实现）、CI 绿后合并、删分支
- [ ] 5.4 #66 评论：A 已落（存证 + 对拍 + 对账 + 回补），B（11 项实现）待另开 change；写明未验证项
