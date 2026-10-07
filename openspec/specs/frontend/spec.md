# 扩展层（WXT + TypeScript）

## Purpose

定扩展层（`entrypoints/` + `src/`）的代码组织、状态与消息、类型安全、页面动作与质量门，
让「逻辑可单测、跨世界消息不成谜、页面动作四处对齐」这几件事有可验收的规矩。

## Requirements

### Requirement: entrypoints 只接线，逻辑进 `src/lib`

`entrypoints/` SHALL 只做接线（WXT 入口），可单测的逻辑 MUST 落在 `src/lib/`。

#### Scenario: 新增逻辑

- **WHEN** 要写一段有判断的逻辑
- **THEN** 落在 `src/lib/<主题>.ts`，测试同名共置（`<主题>.test.ts`）

#### Scenario: 四个入口各司其职

- **WHEN** 改 `background.ts` / `content.ts` / `inject.content.ts` / `popup|options/main.ts`
- **THEN** 分别只承担：唯一打网络的地方（MCP 调用、角标、看门狗、动作下发）/ 隔离世界的消息中转
  / MAIN 世界的围栏检出与页面 DOM / 读写开关的薄壳

### Requirement: `src/lib` 一主题一文件

新模块 SHALL 一主题一文件、测试同名共置；新建模块前 MUST 先看现成的
`backoff` / `wait` / `gate` / `id` / `channel` 有没有可复用的。

#### Scenario: 想新建模块

- **WHEN** 只在一处用的小逻辑
- **THEN** 先查现成主题文件，找不到再新建

### Requirement: `src/**` 不碰 console

`src/**` MUST NOT 直接 `console.log`（eslint 只许 `warn` / `error`）；控制台输出留给
`entrypoints/`（浏览器控制台是那里的调试通道）。

#### Scenario: 想打日志

- **WHEN** 需要输出
- **THEN** 走返回值或既有 logger；要进控制台就在 entrypoints 里打

### Requirement: 不直接访问站点、不发网络请求

`src/` 与 `entrypoints/` MUST NOT 直连站点地址，也 MUST NOT 在 MAIN / 隔离世界 `fetch`
（规避 CORS）；fetch 只出现在 background 调的 `src/lib/relay.ts` 里。

#### Scenario: 静态守卫

- **WHEN** 新文件里出现站点地址
- **THEN** `tests/test_no_direct_site_access.py` 变红（豁免名单是白名单制，要按该测试注释扩）

### Requirement: 跨重启状态一律落 `storage.local`

要跨重启的状态 SHALL 落 `storage.local`，键 MUST 只以各模块导出的常量为准，别处不许手写字符串字面量。

#### Scenario: 现有键

- **WHEN** 读写 `toggle` / `speak` / `backoffUntil` / `ds-/asks` / `ds-/failures` / `ds-/watchdog`
- **THEN** 分别用 `TOGGLE_STORAGE_KEY` / `SPEAK_STORAGE_KEY` / `BACKOFF_STORAGE_KEY` /
  `ASKS_STORAGE_KEY` / `FAILURE_LOG_STORAGE_KEY` / `WATCHDOG_CONFIG_STORAGE_KEY`

#### Scenario: 总开关缺键

- **WHEN** `toggle` 键不存在
- **THEN** 视为关，且从不写默认值

### Requirement: 只允许「可随时重建的在途态」不进 storage

不落 `storage.local` 的状态 MUST 是能随时重建的在途态（现只有驱动角标的 `inFlight`）；
MUST NOT 恢复任何形式的现场轮询 / 事件流。

#### Scenario: 想存会话现场

- **WHEN** 需要「上次的现场」
- **THEN** 要么落 storage 当配置，要么按需重查（中继被动，ADR-0011）

### Requirement: 三路消息各有唯一构造与解析点

三路消息 SHALL 各有唯一出处：chain（MAIN ↔ 隔离世界，`postMessage`，`kind` 判别，
`source` 固定 `ds-/chain`）、runtime（content ↔ background）、background ↔ 中继（`POST /mcp`
JSON-RPC，唯一客户端 `src/lib/relay.ts`）。构造与解析 MUST 都住在 `src/lib/channel.ts`。

#### Scenario: 新增一种 chain 消息

- **WHEN** 加新 `kind`
- **THEN** 构造 `*Message()` 与解析 `parse*` 在 `channel.ts` 成对加、成对测

#### Scenario: 别处手搓信封

- **WHEN** 在别的文件里拼 chain / runtime 信封
- **THEN** 判不合规，退回 `channel.ts`

### Requirement: 跨边界的载荷一律过 parse

页面 DOM、`postMessage`、`runtime.sendMessage`、中继响应四处的形状 SHALL 当 `unknown` 处理，
MUST 经 `channel.ts` / `relay.ts` 的 `parse*` 才能使用。

#### Scenario: 认不出

- **WHEN** 围栏里的 JSON 排坏
- **THEN** `parseToolCall` 不猜，产出 `okPayload(MALFORMED_CALL_HINT)`
- **WHEN** 中继响应认不出
- **THEN** 回 `errorPayload(FAILURE_UNEXPECTED_RESPONSE)`

#### Scenario: parse 的命名与形状

- **WHEN** 新写一个 parse
- **THEN** 命名 `parse*`（如 `parseSendRequest` / `parseToolsList` / `parseAskReport`），
  判别用字面量联合（`kind: "call" | "result" | …`），不用 `interface` 大口袋

### Requirement: 失败码只取现成册子

失败码 SHALL 取自三本册子（JSON-RPC 层、工具载荷码、动作失败码），MUST NOT 在调用点发明新码；
加码 MUST 两头一起加。

#### Scenario: 想加一个失败码

- **WHEN** 手上没有能表达该失败的码
- **THEN** 先查 `protocol/fixtures/action.json` ↔ `src/lib/action.ts` 的 `ACTION_ERROR_*`，
  以及 `src/lib/failurelog.ts` 的 `relay-unreachable` / `unexpected-response`；仍要加就两边同步加

### Requirement: 页面动作四处对齐

一件页面动作 SHALL 四处对齐：执行器 `src/lib/page.ts` → 名册 `entrypoints/content.ts` 的
`ACTION_ROSTER` → 契约样例 `protocol/fixtures/action.json` → 同名共置测试。

#### Scenario: 加一件动作

- **WHEN** 新增动作
- **THEN** 四处都在，且 fixture 与执行器同批改

#### Scenario: 控件还没实现

- **WHEN** 只是登记一个页面控件
- **THEN** 写进本能力「页面动作的候补控件只登记、不进名册」的候补，MUST NOT 进 `ACTION_ROSTER`
  （进了只会回 `unknown-action`，是假实现）

### Requirement: 写动作登记闸门

会改页面状态的写动作 SHALL 记进 `src/lib/action.ts` 的 `BACKOFF_GATED_ACTIONS`；
动写作框的写动作 SHALL 记进 `SPEAK_GATED_ACTIONS`。

#### Scenario: 新写动作

- **WHEN** 加一个写动作
- **THEN** 按「改不改页面状态」「动没动写作框」分别登记进对应闸门名单

### Requirement: 控件定位优先设计系统语义锚

页面动作的控件定位 SHALL 优先站点设计系统的 `ds-*` class 与语义属性（`role` / `aria-*` /
`data-*` key）；MUST NOT 用哈希 class。图标 `path` MUST NOT 作定位判据——它只作**状态
报告**（`button.get`）。站点 DOM 锚点的完整契约见 `site-dom` 能力。

#### Scenario: 定位控件

- **WHEN** 要找一个按钮
- **THEN** 用 `ds-button` / `role` / `aria-label`，不用 `_52c986b` 这类哈希，也不用图标
  `path` 来决定「找不找得到」

#### Scenario: 图标只用于报告

- **WHEN** 想知道那个圆键此刻承载什么意图
- **THEN** 由 `button.get` 读图标并报 `pressed`，不把它塞进定位判据

### Requirement: 动作 fail-safe

动作找不到认得的控件、或控件不可用时 SHALL 抛
`PageError(ACTION_ERROR_PAGE_CHANGED)`，MUST NOT 猜、MUST NOT 假装做过。**「元素在」不等于
「可用」**：带 `ds-button--disabled` 或没渲染出盒子都不算可用。控件**可用**时则点它——
命中判据不含意图，点下去是发送还是停止由页面决定。

#### Scenario: 控件不在

- **WHEN** 认可的锚点一个都没命中
- **THEN** 回 `page-changed`（fail-safe，绝不误点发送）

#### Scenario: 控件不可用

- **WHEN** 圆键在但带 `ds-button--disabled`（空输入框时它是禁用态），或没有渲染出盒子
- **THEN** `button.click` 回 `page-changed`，不点

#### Scenario: 控件可用就点（不管它是发送还是停止）

- **WHEN** `button.click` 到达而圆键此刻是停止方块（生成中）
- **THEN** 点它——这就是停止，页面自己的语义；`button.click` 不判意图

### Requirement: 一个按钮一个动作

名册 SHALL 按**控件**划分最小单元，一个按钮只能对应一个动作；MUST NOT 因站点把多个意图
压进同一个 DOM 元素而把它拆成多个动作（那是站点形状，不是我们的契约）。同一元素上按图标
区分意图的做法 SHALL 淘汰——图标区分的是意图，不是控件身份。

#### Scenario: 站点把两个意图压进一个键

- **WHEN** 同一个圆键在生成期变成停止键（class 一个不换、只有图标不同）
- **THEN** 名册里只有**一个**动作指向它（`button.click`），不是两个各认一种图标的动作

#### Scenario: 读动作与写动作成对

- **WHEN** 一个控件的状态需要先读
- **THEN** 读独立成一条读动作（`button.get`），照 `think.get`/`think.set` 的成对形状

### Requirement: 按钮的读写成对

`button.get` SHALL 只读不点，返回 `{ pressed: "send" | "stop" | "unknown" }`——图标认不出
回 `unknown`（**成功**返回，键在但不知是什么是有效事实），圆键整个不在才回 `page-changed`。
`button.click` SHALL 只点不读意图，返回 `{}`；其命中判据是「圆键在 + 可用」，MUST NOT 含
图标。`button.get` 不受任何闸；`button.click` SHALL 同时进「代你发言」闸与「退避」闸，
MUST NOT 按 `pressed` 动态放行。

#### Scenario: 先读后写

- **WHEN** agent 想停一次生成
- **THEN** `button.get` 读到 `stop` 再 `button.click`；`click` 自己不判断

#### Scenario: 图标认不出

- **WHEN** 圆键在但图标既非箭头也非方块（站点换图标 / 思考期环形）
- **THEN** `button.get` 回 `pressed: "unknown"`；`button.click` 的判据不受影响，照可用性决定

#### Scenario: 闸关着点不了按钮

- **WHEN** 「代你发言」闸关着而 agent 发 `button.click`
- **THEN** 回 `disabled`，哪怕此刻圆键其实是停止键——点击结果在闸关着时判不出，保守即正确

#### Scenario: 退避期同样点不了

- **WHEN** 账号在退避期而 agent 发 `button.click`
- **THEN** 回 `disabled`（它总是改页面状态）；`button.get` 不受影响，照样读得出处境

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

### Requirement: 质量门一道跑全

提交前 SHALL 跑 `pnpm quality`（= eslint + tsc + vitest + prettier + ruff check/format + pytest）
并全绿；生成物 MUST NOT 进检查。

#### Scenario: 生成物不进 lint / 格式化

- **WHEN** `.opencode/`（OpenSpec 生成物）被 eslint / prettier / ruff 扫到
- **THEN** 判不合规——同 `vendor/` 口径排除，且别手改（升级会重生成）

#### Scenario: 改线协议

- **WHEN** 改了 `protocol/fixtures/*.json`
- **THEN** TS 与 pytest 两侧同步改（fixture 对拍会红）

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

### Requirement: 页面动作的候补控件只登记、不进名册

页面上**不在**名册里的控件 SHALL 按「建议动作名 / 定位（真机实测）/ 返回形状」三列登记成
候补，状态记「只登记」，MUST NOT 写进 `entrypoints/content.ts` 的 `ACTION_ROSTER`——
**登记 ≠ 名册**：写了却没执行器，点下去只会回 `unknown-action`，是假实现。

定位口径同「控件定位优先设计系统语义锚」（`ds-*` / `role` / `aria-*`，不碰哈希 class）；
已实现动作另见 `protocol/fixtures/action.json` 与 `src/lib/page.ts`。

候补 SHALL 等真机确认后再升级，MUST NOT 凭文档里「待真机确认」的选择器直接上真机写执行器。
**用途未认出的控件 SHALL 记「待查」并写下线索，MUST NOT 硬编一个动作名。**
真机证据以 2026-10-06 爬取为准（`scripts/page-action.py`，会话 `976c5618`）。

#### Scenario: 登记一个候选控件

- **WHEN** 认出页面上某个控件可做成动作，但还没实现
- **THEN** 按三列写进候补并标「只登记」，MUST NOT 进 `ACTION_ROSTER`

#### Scenario: 消息工具栏六项（真机 2026-10-06 实测）

- **WHEN** 想给 assistant 消息的工具栏 6 颗按钮做动作
- **THEN** 登记：
  - `message.copy`（复制，第 1 颗）
  - `message.retry`（重新生成，第 2 颗，带 `aria-disabled=false` 表示可用态）
  - `message.like`（喜欢，第 3 颗）
  - `message.dislike`（不喜欢，第 4 颗）
  - `message.read`（朗读，第 5 颗，**唯一带 `aria-label="朗读"`**，作语义锚）
  - `message.share`（分享，第 6 颗）
    六颗按钮**逐字节同形**：`div[role=button].ds-button.ds-button--iconLabelTertiary.ds-button--icon.ds-button--capsule.ds-button--xs.ds-button--icon-relative-l` + 同一哈希 `db183363`，`tabindex=0`，无文字、无 `title`、无 `data-*`；身份**仅靠 DOM 序**（以 `aria-label="朗读"` 为锚向前/向后数）与悬停 tooltip 识别。六项都要「第几条消息」参数，**只登记、不进名册**。

#### Scenario: 代码块那两项（真机 2026-10-06 实测）

- **WHEN** 想给代码块的「复制 / 下载」做动作
- **THEN** 登记 `code.copy` / `code.download`，都要「第几个块」参数。
  真机结构：`div.md-code-block.md-code-block-light` → `md-code-block-banner-wrap`（语言标签）+ `pre` + 2 个 `svg`；两颗按钮在 `md-code-block-banner-wrap` 内，`[role=button].ds-button.ds-button--borderlessNeutral.ds-button--borderless.ds-button--capsule.ds-button--xs.ds-button--icon-relative-m.ds-button--min-width`，`textContent` 分别为「复制」「下载」——**靠块内文字定位**。两项**只登记、不进名册**。

#### Scenario: 附件上传

- **WHEN** 想把 `attach.add` 做成动作
- **THEN** 登记为候选（背后是 `input[type=file][multiple]`），**要文件数据、风险高**，先登记不实现

#### Scenario: 页头分享（真机 2026-10-06 实测）

- **WHEN** 想给会话页头右上唯一按钮做动作
- **THEN** 登记 `header.share`（分享），真机位置 (1421,12)，无需额外参数，**只登记、不进名册**

#### Scenario: 侧栏搜索与收起边栏（真机 2026-10-06 实测）

- **WHEN** 想给侧栏顶部两颗按钮做动作
- **THEN** 登记：
  - `sidebar.search`（搜索 ⌘K，位置 (198,25)）
  - `sidebar.collapse`（收起边栏，位置 (232,25)）
    真机均为 `ds-button` 系、有文字标签，**只登记、不进名册**

#### Scenario: 模型选择（真机 2026-10-06 实测）

- **WHEN** 找模型选择控件
- **THEN** 记「当前 UI 未见」：全仓 class 含 `model` 0 命中、真机探针 `ax` 与悬停 tooltip 均无模型选择相关控件，**不编动作名**

#### Scenario: 为什么这些项只是登记（v1 名册边界）

- **WHEN** 问候补为什么没进 v1
- **THEN** v1 名册（`ACTION_ROSTER`）已含：`think.get/set`、`search.get/set`、`button.get/click`、`send.enter`、`chat.new`、`wait.fence/reply`、`messages.list/last`、`composer.read/type/clear`、`tabs.list`、`page.state`——这些都有执行器、四处对齐、测试过。
  候补项（消息工具栏六项、代码块两项、附件上传、页头分享、侧栏两项）**需要索引参数 / 文件数据 / 改动面大**，改动与误伤面都大——理由记在候补里，**等真机存证对拍（ADR-0018）落地后再考虑实现**。

#### Scenario: 候补项要上真机

- **WHEN** 想把某个候补实现成动作
- **THEN** 先真机确认定位与用途，再按「页面动作四处对齐」四处一起落；且须满足 ADR-0018 的真机存证对拍要求
