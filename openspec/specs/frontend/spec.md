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
- **THEN** 只写 `docs/page-actions.md`，MUST NOT 进 `ACTION_ROSTER`（进了只会回 `unknown-action`，是假实现）

### Requirement: 写动作登记闸门

会改页面状态的写动作 SHALL 记进 `src/lib/action.ts` 的 `BACKOFF_GATED_ACTIONS`；
动写作框的写动作 SHALL 记进 `SPEAK_GATED_ACTIONS`。

#### Scenario: 新写动作

- **WHEN** 加一个写动作
- **THEN** 按「改不改页面状态」「动没动写作框」分别登记进对应闸门名单

### Requirement: 控件定位优先设计系统语义锚

页面动作的控件定位 SHALL 优先站点设计系统的 `ds-*` class 与语义属性（`role` / `aria-*` /
`data-*` key）；MUST NOT 用哈希 class。站点 DOM 锚点的完整契约见 `site-dom` 能力。

#### Scenario: 定位控件

- **WHEN** 要找一个按钮
- **THEN** 用 `ds-button` / `role` / `aria-label` / 图标 `path`，不用 `_52c986b` 这类哈希

### Requirement: 同一元素多态按图标 `path` 判别

站点会用同一个键换图标而不换 class；此时 SHALL 只按图标 `path` 判别，
MUST NOT 用「不是 X」反推另一种状态。

#### Scenario: 发送键与停止键是同一个圆键

- **WHEN** 生成期箭头被换成方块（class 一个不换、`aria-label` 为空）
- **THEN** 方块 `path`（`M2 4.88C2 3.68009…`）= 停止、箭头 `path`（`M8.3125 0.980206…`）= 发送；
  认不出回 `page-changed`，绝不把发送当停止点

### Requirement: 动作 fail-safe

动作找不到认得的控件时 SHALL 抛 `PageError(ACTION_ERROR_PAGE_CHANGED)`，
MUST NOT 猜、MUST NOT 假装做过。

#### Scenario: 控件不在

- **WHEN** 认可的锚点一个都没命中
- **THEN** 回 `page-changed`（fail-safe，绝不误点发送）

### Requirement: 生成分两相，停止键只认停止相

`stop.click` SHALL 只认**启用的停止方块**（16×16）；思考期的禁用环形 spinner（36×36）
不算。真机探针要等到停止相再发。

#### Scenario: 生成期与思考期

- **WHEN** 页面在思考期（环形）就发停止
- **THEN** 不命中，回 `page-changed`

### Requirement: 真机 DOM 落成回归用例

抓到的真实 `outerHTML` SHALL 原样进 jsdom 回归用例，命中与相邻态不误命中两个方向都要测。

#### Scenario: 站点改版

- **WHEN** 站点改版
- **THEN** 这条用例先红

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
  `stop-test`（端到端）/ `storage get|set|remove` / `capture` / `ax`

#### Scenario: 手动起浏览器

- **WHEN** 手动 `--load-extension`
- **THEN** 必须用**新构建**，否则会出「页面明明在生成、动作却回 `page-changed`」的假失败
  （`env-up.sh` 会自动重建并换）
