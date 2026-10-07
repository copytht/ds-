## ADDED Requirements

### Requirement: 页面控件存证原样且对拍

每个页面动作最小单元（含只登记的候补）SHALL 在 `protocol/evidence/controls.json` 留一条存证，
原样保留**按钮的代码**与**按钮的图片**，并 SHALL 由测试检查符合原样（ADR-0018）。

一条存证 MUST 含：

- `id`（文件内唯一）与 `capturedOn`（真机日期，`YYYY-MM-DD`）；
- `outerHTML`：真机抓到的整段，tag、全部 class（**含哈希 class**）、`role`、`aria-*`、`tabindex`、
  `style`、内部结构，一个字不缩写；
- `svgs`：该按钮内每个内联 `svg` 的 `viewBox` 与全部 `path` 原文（`fill` / `stroke` 一并留）；
- `row`：它所在的**那一排**——父容器、同排几颗、它排第几、从哪颗语义锚数起；单颗控件写 `null`；
- `reconcile`：`live`（常驻，可对账）或 `state-bound`（只在某个态出现，对账时只报「当前态不符、未比」）；
- `probe`：只读 JS 表达式，在页面上下文里返回站点当前那一颗的 `outerHTML`（找不到返回 `null`），
  只供对账用，MUST NOT 被执行器当定位判据。

存证是**证据**，不是**定位判据**：定位仍按「控件定位优先设计系统语义锚」，图标 `path` 照旧不作判据。

#### Scenario: 存证条目缺东西

- **WHEN** 某条存证缺 `capturedOn`、缺 `outerHTML`、`svgs` 与 `outerHTML` 里解析出的 `svg` 不一致
  （`viewBox` 或 `path` 少一条 / 被改一个字），或 `outerHTML` 含省略号占位 / 不成对的 tag
- **THEN** CI 的对拍测试判红，TS 与 pytest 两侧各自都判

#### Scenario: 回归用例手抄原件

- **WHEN** 某个 `*.test.ts` 的源码里出现了存证 `svgs` 里某条 `path` 的原文
- **THEN** 对拍测试判红——原件 MUST 住在存证文件里，用例用 `evidenceHtml(id)` 读，不许手抄

#### Scenario: 站点改版，存证过时

- **WHEN** 探针的真机对账发现站点当前那一颗的 `outerHTML` 与 `reconcile: live` 的存证不逐字相等
- **THEN** 报「站点改版，存证过时」并列出 `id` 与差异、进程以非零退出，让人重抓；
  `state-bound` 的存证只报「当前态不符、未比」，不算过时

#### Scenario: 对账不进质量门

- **WHEN** 跑 `pnpm quality`
- **THEN** 只跑「存证 ↔ 回归用例」的 CI 对拍；「站点 ↔ 存证」的真机对账 MUST NOT 进质量门
  （要登录 + paced 探针，CI 够不着），按需本地跑

#### Scenario: 登记一颗新的最小单元

- **WHEN** 登记或实现一个新的页面动作 / 候补
- **THEN** 同批在 `controls.json` 加一条存证；**不许先写一句文字描述占位**

## MODIFIED Requirements

### Requirement: 真机 DOM 落成回归用例

抓到的真实 `outerHTML` SHALL 原样进 jsdom 回归用例，命中与相邻态不误命中两个方向都要测。
原件 MUST 来自 `protocol/evidence/controls.json`（用例用 `evidenceHtml(id)` 读），MUST NOT 在用例里手抄或缩写。

#### Scenario: 站点改版

- **WHEN** 站点改版
- **THEN** 这条用例先红

#### Scenario: 用例要用的原件

- **WHEN** 回归用例需要某颗按钮的真机 HTML（如圆键三态、代码块）
- **THEN** 从存证文件按 `id` 取，改相邻态只许在取到的原件上做 `replace` 之类的最小变形，
  不许另写一份手抄的整段

### Requirement: 真机探针走 `scripts/page-action.py`

真机验页面动作 SHALL 走 `scripts/page-action.py`（配 `scripts/env-up.sh --debug`），
它经内容脚本名册执行、**绕开 `runAction` 的三道闸**，只可读渲染 DOM 与重载扩展。

#### Scenario: 可用的子命令

- **WHEN** 需要真机
- **THEN** 用 `read`（页面状态）/ `send <动作> [--params json]` / `js <表达式>` /
  `stop-test`（端到端）/ `storage get|set|remove` / `capture` / `ax` / `evidence`（存证对账）

#### Scenario: 手动起浏览器

- **WHEN** 手动 `--load-extension`
- **THEN** 必须用**新构建**，否则会出「页面明明在生成、动作却回 `page-changed`」的假失败
  （`env-up.sh` 会自动重建并换）

#### Scenario: 真机对账

- **WHEN** 跑 `page-action.py evidence [--id <id>]`
- **THEN** 它只读渲染 DOM（不 dispatch 事件、不点任何按钮），把存证里 `reconcile: live` 的条目
  与站点当前那一颗逐字比，并走与其它写站点命令一样的 paced 限速
