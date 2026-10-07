## Why

ADR-0018 已接受：制作页面动作的最小单元时，必须**原样保留按钮的代码与图片**，且**测试要检查符合原样**。
但它只是一篇 ADR——`frontend` spec 里还没有对应的 requirement，仓里也没有存证文件、没有对拍测试、
探针也没有真机对账入口。现状正是 ADR 里点名的缺口：`messages.test.ts` 的代码块 fixture 是缩写的，
`page.test.ts` 的圆键三态是手抄在用例里的——缩写发生了没人发现。

#66 要把 11 项候补控件实现进名册，spec 已写明候补上真机须满足 ADR-0018。所以得先把这道前置闸落地，
再做 11 项实现（另开 change）。

## What Changes

- 新增**存证文件**：真机 `outerHTML` + 完整 `svg path` + 真机日期，一颗按钮一条；原件住文件，不住用例。
- 新增 **CI 对拍**（进 `pnpm quality`）：TS 与 pytest 两侧各一份，照 `fixtures.test.ts` / `test_fixtures.py`
  那对「两半对拍」的样子写；检查存证条目完整（缺字段 / 缺 `svg path` / 缺日期就红）。
- **回归用例从存证文件读、不手抄**：
  - 圆键三态（`STOP_BUTTON_HTML` / `SEND_BUTTON_HTML` / `SPINNER_BUTTON_HTML`）从手抄常量改成读存证；
  - `messages.test.ts` 缩写过的代码块 fixture 回补成真机原样（要真机重抓一次代码块；补完确认 `readRow` 对真实结构仍成立）。
- `scripts/page-action.py` 加**真机对账子命令**：留档 `outerHTML` 与站点当前那一颗逐字比，不等就报
  「站点改版，存证过时」。这一半要真机、要登录、走 paced 探针，**不进 `pnpm quality`**。
- `frontend` spec：新增 requirement 承载 ADR-0018「必须怎样」；修改两条既有 requirement
  （`真机 DOM 落成回归用例`、`真机探针走 scripts/page-action.py`）。
- **不做**：11 项候补进名册（另开 change，在本 change 合并之后）；候补那批的存证由那个 change 随实现一并入档。

## Capabilities

### New Capabilities

- (none)

### Modified Capabilities

- `frontend`: 新增「页面控件存证原样且对拍」requirement；`真机 DOM 落成回归用例` 改为原件来自存证文件、不许手抄；
  `真机探针走 scripts/page-action.py` 增加真机对账子命令

## Impact

- 新增 `protocol/evidence/` 下的存证文件（位置与格式见 design）
- 新增两侧对拍测试：`src/lib/evidence.test.ts`（或并入 `fixtures.test.ts`）+ `tests/test_evidence.py`
- 改 `src/lib/page.test.ts`、`src/lib/messages.test.ts` 的 fixture 来源
- 改 `scripts/page-action.py`（新子命令，过 ruff）
- 改 `openspec/specs/frontend/spec.md`（经归档同步）
- 不改 `ACTION_ROSTER`、不改 `protocol/fixtures/action.json`、不改 `site-dom` 锚点、不改执行器逻辑
  （除非回补代码块 fixture 时发现 `readRow` 对真实结构不成立——那是缺陷，另记）
- 前置：需要 ds-browser（独立 profile）带调试口起着并已登录，才能重抓代码块与跑对账
