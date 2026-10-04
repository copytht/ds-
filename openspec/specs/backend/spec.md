# 中继层（dsb，本机 MCP 网关）

## Purpose

定本机 MCP 网关 `dsb/`（Python，uv 管理）的模块划分、配置来源、错误分层、留痕口径与质量门，
让「完全被动、无 CORS、失败只说事件」这些边界有可验收的规矩。

## Requirements

### Requirement: 一模块一职责

`dsb/` SHALL 按模块分职责，入口是 `uv run dsb`（等价 `pnpm relay:dev`）：
`server.py` 只做 HTTP 层、`gateway.py` 管 `mcp.json` 与子进程、`mcp.py` 管 JSON-RPC 语义、
`said.py` 管 `said_*`、`work.py` 管工作工具、`config.py` 管 `.env` 与端口、`log.py` 管留痕。
分层 MUST NOT 越界（`server.py` 里不塞协议语义，`mcp.py` 里不碰 HTTP）。

#### Scenario: HTTP 面

- **WHEN** 请求 `POST /mcp`
- **THEN** 由 `server.py` 处理，且**一条 CORS 头都不下发**（ADR-0011 的决定，不是遗漏）
- **WHEN** 请求别的路径 / 方法
- **THEN** 404 / 405，载荷是在册的 `{"status": "error", …}`；`DELETE /mcp` 回 205

### Requirement: 配置只从 `config.py` 读

端口等配置 SHALL 经 `config.py` 统一读（`.env` → 环境变量），其他模块 MUST NOT 直接
`os.environ` 取值。MCP servers 写在仓库根 `mcp.json`（**不进版本库**）。

#### Scenario: `mcp.json` 缺失

- **WHEN** `mcp.json` 不存在
- **THEN** 视为空工具表，**不是错误**，协议说明写「没有可用工具」

#### Scenario: 工作文件夹 root

- **WHEN** 解析工作目录 root
- **THEN** 顺序 `DSB_WORK_ROOT`（进程环境变量 → `.env` → 本仓根），由 `work.py` 的
  `resolve_work_root` 解析；改完要重启中继才生效（工具表静态）

### Requirement: 唯一的工具注册点与注册顺序

`server.py:build_tools` SHALL 是唯一注册点，顺序为
`gateway.tools() → work_tools(root) → said_tools(said)`；同名后者胜出。

#### Scenario: 加自家工具

- **WHEN** 加一个自家工具
- **THEN** 只在 `build_tools` 挂上即可，**不需要动 TS**（扩展侧只按前缀过滤 `said_`，
  其余工具自动进协议说明）

### Requirement: JSON-RPC 层错误只由 `dsb/mcp.py` 出

JSON-RPC 层错误（协议错、方法不认识、参数坏）SHALL 由 `mcp.py` 定义、被扩展的 MCP 客户端
（`src/lib/relay.ts`）消费；工作工具与网关的**载荷码** SHALL 各有其册子
（网关三码 `tool-not-running` / `tool-timeout` / `unexpected-response`；工作工具十码见
`work.py`）；**动作失败码只在 TS 侧**，Python 侧 MUST NOT 发明动作码。

#### Scenario: 三本册子别混

- **WHEN** 要表达一个失败
- **THEN** 先认它属于哪一层（JSON-RPC / 工具载荷 / 动作），只在该层的册子里取码

### Requirement: 分层转换

`gateway.py` SHALL 用 `GatewayError(code)` 单码异常，在 HTTP / JSON-RPC 边界统一转成在册载荷；
子进程的原始 stderr MUST NOT 冒泡成响应。协议错 SHALL 也是 200 + JSON-RPC error（客户端只认一种成功形）。

#### Scenario: 连不上与超时分开

- **WHEN** 子进程起不来 / 配置文件坏，或调用超时
- **THEN** 措辞分开（超时三档：`MCP_CALL_TIMEOUT_MS=130_000` / `MCP_LIST_TIMEOUT_MS=10_000` /
  `MCP_PING_TIMEOUT_MS=5_000`），不折成一句

#### Scenario: 什么才进对话

- **WHEN** 有回话（result 或 JSON-RPC error、`isError` 结果）
- **THEN** 进对话
- **WHEN** 只有连不上
- **THEN** 落 `FAILURE_RELAY_UNREACHABLE`，且失败提示只在扩展侧、不进对话流（ADR-0010）

### Requirement: 守卫必须 fail-closed

路径沙箱 / 保护名单这类守卫 SHALL 在判定前把两侧都归一（各自 `resolve()`）；
守卫的异常分支 MUST 是「拒绝」，MUST NOT 是「放行」。

#### Scenario: 别名路径

- **WHEN** 同一个地方写法不同（macOS `/var` 与 `/private/var`、符号链接别名）
- **THEN** 先 `resolve()` 再 `relative_to`；`except (ValueError, OSError, RuntimeError): return False`
- **AND** 反例（不归一、被 `except` 吞掉变静默放行、能写进 `.git/`）判不合格

### Requirement: 留痕只记事件，不记正文

留痕 SHALL 只记事件（几点红的、哪个环节、什么原因、多久自己绿的），
MUST NOT 记入参与结果正文（ADR-0004）。

#### Scenario: 中继侧与扩展侧

- **WHEN** 要留痕
- **THEN** 中继侧走 `dsb/log.py` 的 `log_event` 一行事件（`bad-request` / `mcp-broke`；
  工具层 `tool-fail` / `tool-slow` 在 `mcp.py`），扩展侧走 `storage.local` 的 `ds-/failures`

#### Scenario: 不许进日志的东西

- **WHEN** 写日志
- **THEN** 工具入参、工具结果、回灌文本、账号详情都不写

#### Scenario: 访问日志

- **WHEN** 启动中继
- **THEN** 访问日志整个关掉，不要重新打开

### Requirement: 慢与坏分两笔账

`tool-slow`（超 `tool-timeout` 口径）与 `tool-fail`（结果带错）SHALL 分开记；
事件名 SHALL 是名词性短横线词，跟着 `log_event` 既有调用点看齐。

#### Scenario: 新事件名

- **WHEN** 要加一个事件
- **THEN** 先想「这是事件还是正文」，再按名词短横线命名

### Requirement: 网关不做重试与轮询

网关 SHALL 一次 fetch 打到底；MUST NOT 把重试、轮询、退避搬进网关。

#### Scenario: 上游不稳

- **WHEN** 上游失败
- **THEN** 如实回载荷，由调用方决定要不要再来一次

#### Scenario: 错误信息不带正文

- **WHEN** 填错误信息
- **THEN** 不放工具入参或结果正文，也不回显栈 / 子进程输出

### Requirement: 中继质量门

`dsb/` 提交前 SHALL 跑 `uv run ruff check .`、`uv run ruff format --check .`、`uv run pytest`
（或用根目录的 `pnpm relay:lint` / `pnpm relay:test`）；全仓提交前跑 `pnpm quality`。

#### Scenario: 测试布局

- **WHEN** 加测试
- **THEN** 按模块落 `tests/test_*.py`（`test_gateway.py` / `test_mcp_server.py` / `test_said.py` /
  `test_log.py` / `test_config.py` / `test_work.py` / `test_fixtures.py` / `test_no_direct_site_access.py`），
  `asyncio_mode = auto`

#### Scenario: 不许写的东西

- **WHEN** 写测试
- **THEN** 不写真 MCP server 的集成测试（用假子进程 / 假配置），也不断言正文内容（留痕口径不记正文）

#### Scenario: 生成物不进检查

- **WHEN** ruff / eslint / prettier 扫到 `.output/`、`.opencode/`、`captures/`
- **THEN** 已排除（同 `vendor/` 口径：生成物会重生成，别手改）

### Requirement: 已知坑

`Gateway._guard` SHALL 视为不可重入（gateway 锁里再抢同一把锁会自锁）；
`AbortError`（超时）与 `TypeError`（连不上）SHALL 在转换处保持是两种病因。

#### Scenario: 加锁路径

- **WHEN** 在已持锁的路径里调用受 `_guard` 保护的方法
- **THEN** 判不合格，先去掉重入
