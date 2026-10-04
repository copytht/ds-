# 目录结构

`dsb/` 每个模块一件事，入口是 `uv run dsb`（等价 `pnpm relay:dev`）：

| 模块 | 职责 |
| --- | --- |
| `server.py` | HTTP 层（`BaseHTTPRequestHandler` + `ThreadingHTTPServer`）。唯一端点 `POST /mcp`；`DELETE /mcp` → 205；别的路径 404、别的方法 405，载荷都在册的 `{"status": "error", …}`。**一条 CORS 头都不下发**（不是遗漏，是 ADR-0011 的决定） |
| `gateway.py` | `Gateway`、`mcp.json` 加载（`load_config`、`MCP_CONFIG_ENV_KEY`）、`StdioServer` 子进程管理（起停、读写循环、`list_tools` / `call_tool`）、超时解析 `resolve_timeout` |
| `mcp.py` | JSON-RPC 语义：`initialize` / `ping` / `tools/list` / `tools/call` 的应答与**错误码**；工具层事件 `tool-fail` / `tool-slow` |
| `said.py` | 自家 `said_*` 工具（说给人听的收与读） |
| `config.py` | `.env` 与端口（`PORT_ENV_KEY`、`find_dotenv`、`repo_root`） |
| `log.py` | `log_event` 一行式留痕 |

## 配置

- MCP servers 写在仓库根 `mcp.json`（**不进版本库**，`.gitignore` 里有；形状见 `gateway.py` 顶部注释）。
  文件缺失 = 空工具表，**不是错误**，协议说明会写「没有可用工具」。
- 端口等走 `.env` / 环境变量，`config.py` 统一读，别处不许 `os.environ` 直取。

## 反模式

- 加第二条 HTTP 路（`/send`、`/health`、`/status`……）——那些路已随 ADR-0011 全废，
  探活是 `ping`，现场是工具自己的结果。
- 给响应加 CORS 头——预检拿到允许头就破了「网页跨域撞死」这条边界。
- 在 `server.py` 里塞协议语义，或在 `mcp.py` 里碰 HTTP——分层按上表走。
