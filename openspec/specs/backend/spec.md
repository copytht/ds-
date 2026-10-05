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

### Requirement: dsb 内建五件工作工具，root 钉死

dsb SHALL 内建 `ls` / `read` / `grep` / `write` / `edit` 五件**裸名**工具（`dsb/work.py`，
逻辑是对 `root: Path` 的纯函数），全部钉死在一个可配的**工作文件夹 root** 内
（`DSB_WORK_ROOT`：进程环境变量优先、其次 `.env`、最后本仓根）。

相对路径 SHALL 以 root 为基准，`resolve()` 后越界一律回 `out-of-root`——**跟符号链接、挡 `..`**。
工具名 SHALL 是裸名（第三方恒带 `<server>_` 前缀，正常不撞），注册顺序
`gateway → work → said`，撞名时自家 `said_*` 最后胜出。

root 不存在时 SHALL **照常起服务、调用时才回 `bad-path`**——与「没配 MCP server 只打印一行」
同一口径，MUST NOT 因为配置缺失就让整个网关起不来。

#### Scenario: 路径越界

- **WHEN** 相对路径 `resolve()` 后落在 root 之外（含经符号链接）
- **THEN** 回 `out-of-root`，MUST NOT 读或写

#### Scenario: root 没配

- **WHEN** `DSB_WORK_ROOT` 指向不存在的目录而服务照常起
- **THEN** 调用那五件时才回 `bad-path`，MUST NOT 让整个网关起不来

### Requirement: 工作工具不给命令执行面，写改拒 `.git/`

MUST NOT 提供 SHELL / exec 类工具：任意命令天生能越界，与 root 硬边界冲突；探索改由
`ls` / `grep` 承担。`tools/list` 里 MUST NOT 出现任何 shell / exec 类工具。

写与改（`write` / `edit`）SHALL 额外拒 `<root>/.git` 之下（`protected-path`，worktree 里
`.git` 是文件也算）；`read` / `ls` 不拦，`grep` 则整个跳过 `.git/`（顺带跳过二进制与超限文件）。

#### Scenario: 想要命令执行面

- **WHEN** 有人要求给 dsb 加 SHELL
- **THEN** 判不合格——任意命令天生能越界，与 root 硬边界冲突；探索用 `ls` / `grep`

#### Scenario: 写 `.git/`

- **WHEN** `write` / `edit` 的目标是 `.git/` 下的路径
- **THEN** 回 `protected-path`；同一路径 `read` / `ls` 照常

### Requirement: 工作工具的单次输出封顶

五件工具的单次输出 SHALL 封顶（保护对话与前程，超了**截断并写明截了什么**，不静默）：
`read` 16k 字符、`ls` 500 项、`grep` 200 命中 / 单行 500 字符 / 只参与 1MB 以内的文件；
`grep` 探二进制只看前 8k，首块里有 `\x00` 就跳过该文件。

#### Scenario: 读一个大文件

- **WHEN** `read` 读到超过 16k 字符的文件
- **THEN** 取前 16k 并在尾巴写「已截断，超出 N 字符」

#### Scenario: 列一个大目录 / 扫一棵大树

- **WHEN** `ls` 超过 500 项，或 `grep` 命中达 200
- **THEN** 截断并写明「共 N 项」「命中数达上限 200」，MUST NOT 悄悄少给

### Requirement: 一次回答可排多块围栏，一轮里各块一趟一块地打

`parseSendFences` SHALL 按出现顺序取出**全部**围栏块；`parseSendFence` 只取第一块，留给
「有没有排围栏」这类判据（`wait.fence`）。

执行侧 SHALL **一趟一块**：一轮里每块各打一次网关（MUST NOT 一个请求塞多块）——扩展对一条
在途 fetch 的保活与超时是**按请求**算的，多块挤一趟会让几件慢工具叠起来先撞超时，
报出来的还是没信息量的「中继不可达」。

结果 SHALL 拼成一段：单块时工具正文**原样交**（不加自己写的头尾）；多块时每块前面写一行
`工具 <名字>：`。一轮 SHALL 有上限 `MAX_CALLS_PER_ROUND = 8`，排多了先执行前 8 块，
剩下的在正文里说明「下一轮再排」。

**排坏的块也占一块**：那一块回 `MALFORMED_CALL_HINT`，别的块照常执行——MUST NOT 因为一块形状
不对把整轮搭进去。只有**连不上中继**才整轮作废（已跑完的那几块结果不交回）。

#### Scenario: 一轮排了三块

- **WHEN** 模型一次回答里排了 3 块 send 围栏
- **THEN** 检测侧全取；执行侧打 3 次网关（各一趟）；结果拼成一段，每块前面有 `工具 <名字>：`

#### Scenario: 一块排坏

- **WHEN** 一轮里有一块 JSON 排坏
- **THEN** 那一块回 `MALFORMED_CALL_HINT` 并**占掉一个名额**，其余块照常执行

#### Scenario: 排了十块

- **WHEN** 模型一轮里排了 10 块
- **THEN** 执行前 8 块，正文里说明「这一轮最多执行 8 块围栏，还有 2 块没执行——下一轮再排」

#### Scenario: 第一块连不上中继

- **WHEN** 一轮里第一块连不上中继
- **THEN** 整轮作废（与单块时一个脾气），已跑完的块结果不交回

### Requirement: 网关对单次结果封顶

`text_of_result` 的口径是「不猜、不丢」，代价是没有上限——一条失控结果（几十兆的目录树、
整份日志）会同时灌满对话、扩展的内存与 storage。SHALL 按**字符**封顶
（`MAX_RESULT_CHARS = 64K 字`，切在多字节字符中间对谁都没好处），超了截断并在尾巴上写明
「原文 N 字，这里是前 64K 字」，记一笔 `result-capped tool=… chars=…`。

限额 SHALL 是常量而不是配置项（要调就改常量，有测试钉着），免得一份 `.env` 把它们改成 0，
生效值 SHALL 打给启动日志看。扩展侧对**给模型看的**正文另有 2000 字截断（`continuation`
能力），两道各管一段，别混。

#### Scenario: 超长结果

- **WHEN** 单次结果超过 64K 字
- **THEN** 截断 + 尾巴写明原长，记 `result-capped`；MUST NOT 静默截

### Requirement: 网关对单个服务的工具数封顶

`MAX_TOOLS_PER_SERVER = 128`：某个 MCP server 注册了更多工具时 SHALL 只注册前 128 件，
记一笔 `tools-capped tool=… count=…`——记的是**原文件数**，人才看得出被砍了多少。

#### Scenario: 工具太多的 server

- **WHEN** 某个 MCP server 注册了超过 128 件工具
- **THEN** 只注册前 128 件，`tools-capped` 记**原文件数**

### Requirement: 网关三档超时各是各的

握手 `DSB_CONNECT_TIMEOUT`（默认 30s，npx 首次下载要时间）、发现 `DSB_DISCOVERY_TIMEOUT`
（默认 20s，一次就够）、调用 `DSB_TOOL_TIMEOUT`（默认 120s，长工具循环要跑得住）
SHALL 三档分开，MUST NOT 再共用一档。三个键都认进程环境与 `.env`，认不出或非正数落默认。

#### Scenario: 哪一档慢

- **WHEN** `tools/list` 慢
- **THEN** 按**发现档**（20s）判，不是握手档——分档才看得出慢在哪
