# 错误处理

## 三本码册，别混

| 层 | 码长在哪 | 谁消费 |
| --- | --- | --- |
| JSON-RPC 层（协议错、方法不认识、参数坏） | `dsb/mcp.py` | 扩展的 MCP 客户端（`src/lib/relay.ts`） |
| 工具载荷码（`tool-not-running` / `tool-timeout` / `unexpected-response`） | `gateway.py` / `said.py` 的册子 | 回灌进对话的结果载荷 |
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
