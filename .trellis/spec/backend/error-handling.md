# 错误处理

## 三本码册，别混

| 层 | 码长在哪 | 谁消费 |
| --- | --- | --- |
| JSON-RPC 层（协议错、方法不认识、参数坏） | `dsb/mcp.py` | 扩展的 MCP 客户端（`src/lib/relay.ts`） |
| 工具载荷码（网关三码 `tool-not-running` / `tool-timeout` / `unexpected-response`；工作工具十码 `out-of-root`/`bad-path`/`protected-path`/`not-found`/`not-a-file`/`not-a-directory`/`edit-no-match`/`edit-not-unique`/`bad-regex`/`io-failed`） | `gateway.py` / `said.py` / `work.py` 的册子 | 回灌进对话的结果载荷 |
| 动作失败码 | **TS 侧册子**：`protocol/fixtures/action.json` ↔ `src/lib/action.ts` 的 `ACTION_ERROR_*` | 看门狗与出站动作；Python 侧没有这本册子，别在这边发明动作码 |

扩展侧的两失败码 `relay-unreachable`（连不上）与 `unexpected-response`（非 2xx / 认不出）
定义在 `src/lib/failurelog.ts`，`FailureWhere` 只有 `health|call|watchdog` 三环节。

## 分层转换

- `gateway.py` 用 `GatewayError(code)` 单码异常，HTTP / JSON-RPC 边界处统一转成在册载荷；
  不要让子进程的原始 stderr 冒泡成响应。
- **协议错也是 200 + JSON-RPC error**（同构一处解析，客户端只认一种成功形）；
  非 `/mcp` 的 404/405 才是 HTTP 层载荷。
- 措辞分开：**连不上**（子进程起不来、配置文件坏）与**超时**（三档 `MCP_CALL_TIMEOUT_MS=130_000` /
  `MCP_LIST_TIMEOUT_MS=10_000` / `MCP_PING_TIMEOUT_MS=5_000`）是两种病因，别折成一句。
- 有回话（result 或 JSON-RPC error、`isError` 结果）→ 进对话；**只有连不上**才落
  `FAILURE_RELAY_UNREACHABLE`，且失败提示只在扩展侧，不进对话流（ADR-0010）。

## 反模式

- 重试、轮询、退避搬进网关——一次 fetch 打到底，dsb 也不代客重试。
- 把入参或结果正文放进错误信息——正文不进留痕（ADR-0004，见 `logging-guidelines.md`）。
- 为「方便调试」回显栈或子进程输出。

## 护栏必须 fail-closed

路径沙箱 / 保护名单这类**守卫**，判定前两侧都要归一（各自 `Path.resolve()`），
否则同一个地方写法不同（macOS `/var` 与 `/private/var`、符号链接别名）会让
`relative_to` 抛 `ValueError` ——**被 `except` 吞掉就变成静默放行**（fail-open），
护栏形同虚设。守卫的异常分支只能是「拒绝」，不能是「放行」。

- 反例：`resolved.relative_to(root)` 直接比，别名场景抛错 → `return False` → 写进 `.git/` 也放行。
- 正例：`resolved.resolve().relative_to(root.resolve())`，`except (ValueError, OSError, RuntimeError): return False`
  ——「不在保护名单里」是**归一后**的结论，不是解析失败的兜底。
- 写法参见 `dsb/work.py` 的 `protected_git` 与 `resolve_in_root`；回归测试
  `test_protected_git_normalizes_paths_before_comparing`（符号链接别名 root）。
