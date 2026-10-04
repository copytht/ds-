# 中继层规范（backend/）

范围：`dsb/`——本机 MCP 网关（Python，uv 管理）。目录名沿用 Trellis 模板划分：
**backend = dsb**，**frontend = 扩展层**（见 `../frontend/`）。
身份与端点由 `docs/adr/0011-dsb-is-a-stateless-mcp-gateway.md` 定死：唯一端点 `POST /mcp`，完全被动。

## 指南索引

| 指南 | 何时看 |
| --- | --- |
| [目录结构](./directory-structure.md) | 动 `dsb/` 任何模块、加端点、加配置 |
| [错误处理](./error-handling.md) | 加失败码、改失败载荷、动超时 |
| [日志](./logging-guidelines.md) | 留痕、事件名、什么不许进日志 |
| [质量](./quality-guidelines.md) | ruff / pytest / 静态守卫 |

## 上游文档

术语看根 `CONTEXT.md`（「中继」「停机说明」「工作文件夹」「工作工具」等词条）；决策先读
`docs/adr/0011`（身份与端点）、工作工具读 `docs/adr/0012`，失败留痕读 `docs/adr/0004`。
