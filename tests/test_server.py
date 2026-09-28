from dsb.server import mcp, ping


def test_ping_answers_pong() -> None:
    assert ping() == "pong"


async def test_exposes_ping_tool() -> None:
    tools = await mcp.list_tools()
    assert [tool.name for tool in tools] == ["ping"]


async def test_tool_has_a_description() -> None:
    tools = await mcp.list_tools()
    assert tools[0].description
