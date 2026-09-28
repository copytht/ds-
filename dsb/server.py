"""ds-mcp 的 MCP 服务入口：`uv run ds-mcp` 走 stdio 起进程。"""

from mcp.server.mcpserver import MCPServer

mcp = MCPServer(
    name="ds-mcp",
    description="MCP server for the ds- browser extension",
    instructions="管理 ds- 浏览器扩展暴露给模型的能力。",
)


@mcp.tool()
def ping() -> str:
    """健康检查：确认 MCP 进程存活并能正常应答。"""
    return "pong"


def main() -> None:
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
