# Spec Delta

## ADDED Requirements

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
