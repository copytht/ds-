"""MCP 网关：stdio 子进程的拉起、汇总、转发，以及三个失败码的册子。"""

from __future__ import annotations

import json
import sys
import textwrap
from pathlib import Path

import pytest

from dsb.gateway import (
    ERROR_NOT_RUNNING,
    ERROR_TIMEOUT,
    ERROR_UNEXPECTED,
    Gateway,
    command_of,
    load_config,
    normalize,
    resolve_timeout,
    text_of_result,
)

#: 替身 MCP server：说标准 JSON-RPC over stdio。按 arguments.text 的暗号走四种岔路。
FAKE_SERVER = """
import json, sys, time

TOOLS = [
    {
        "name": "echo",
        "description": "回声",
        "inputSchema": {"type": "object", "properties": {"text": {"type": "string"}}},
    }
]

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        msg = json.loads(line)
    except json.JSONDecodeError:
        continue
    method, rid = msg.get("method"), msg.get("id")
    if method is None or rid is None:
        continue  # 我们的 notifications/initialized：收下不答
    if method == "initialize":
        reply = {"jsonrpc": "2.0", "id": rid, "result": {
            "protocolVersion": "2025-06-18",
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "fake", "version": "0"},
        }}
    elif method == "tools/list":
        reply = {"jsonrpc": "2.0", "id": rid, "result": {"tools": TOOLS}}
    elif method == "tools/call":
        text = str(msg.get("params", {}).get("arguments", {}).get("text", ""))
        if text == "hang":
            time.sleep(60)
            continue
        if text == "die":
            sys.exit(1)
        if text == "boom":
            reply = {"jsonrpc": "2.0", "id": rid, "error": {"code": -32603, "message": "boom"}}
        elif text == "iserr":
            reply = {"jsonrpc": "2.0", "id": rid, "result": {
                "content": [{"type": "text", "text": "底层说不行"}], "isError": True,
            }}
        else:
            reply = {"jsonrpc": "2.0", "id": rid, "result": {
                "content": [{"type": "text", "text": text}], "isError": False,
            }}
    else:
        reply = {"jsonrpc": "2.0", "id": rid, "error": {"code": -32601, "message": "no"}}
    sys.stdout.write(json.dumps(reply) + "\\n")
    sys.stdout.flush()
"""


@pytest.fixture()
def fake_script(tmp_path: Path) -> Path:
    path = tmp_path / "fake_mcp_server.py"
    path.write_text(textwrap.dedent(FAKE_SERVER), encoding="utf-8")
    return path


def make_gateway(fake_script: Path, *, timeout: float = 3.0) -> Gateway:
    return Gateway.from_config(
        {"fake": {"command": [sys.executable, str(fake_script)]}}, timeout=timeout
    )


@pytest.fixture()
def gateway(fake_script: Path):
    gate = make_gateway(fake_script)
    yield gate
    gate.stop()


# ---- 配置与名字 ----


def test_command_accepts_both_shapes() -> None:
    assert command_of({"command": ["npx", "-y", "srv"]}) == ["npx", "-y", "srv"]
    assert command_of({"command": "npx", "args": ["-y", "srv"]}) == ["npx", "-y", "srv"]
    assert command_of({"command": ""}) is None
    assert command_of({"args": ["-y"]}) is None
    assert command_of({"command": [1, 2]}) is None


def test_load_config_reads_mcp_servers_and_tolerates_the_missing(tmp_path: Path) -> None:
    assert load_config(tmp_path / "nope.json") == {}
    target = tmp_path / "mcp.json"
    target.write_text(
        json.dumps({"mcpServers": {"fs": {"command": ["x"]}, "bad": "不是对象"}}),
        encoding="utf-8",
    )
    assert load_config(target) == {"fs": {"command": ["x"]}}
    broken = tmp_path / "broken.json"
    broken.write_text("坏掉的 json", encoding="utf-8")
    assert load_config(broken) == {}


def test_normalize_folds_everything_odd() -> None:
    assert normalize("文件系统") == "____"
    assert normalize("fs_read-file") == "fs_read-file"


def test_resolve_timeout_prefers_the_process_then_the_env_file_then_default() -> None:
    from dsb.gateway import DEFAULT_TOOL_TIMEOUT, TOOL_TIMEOUT_ENV_KEY

    assert resolve_timeout("") == DEFAULT_TOOL_TIMEOUT
    assert resolve_timeout(f"{TOOL_TIMEOUT_ENV_KEY}=7.5\n") == 7.5
    assert resolve_timeout(f"{TOOL_TIMEOUT_ENV_KEY}=不是数\n") == DEFAULT_TOOL_TIMEOUT
    assert resolve_timeout(f"{TOOL_TIMEOUT_ENV_KEY}=-1\n") == DEFAULT_TOOL_TIMEOUT


def test_resolve_timeout_process_env_wins(monkeypatch: pytest.MonkeyPatch) -> None:
    from dsb.gateway import TOOL_TIMEOUT_ENV_KEY

    monkeypatch.setenv(TOOL_TIMEOUT_ENV_KEY, "11")
    assert resolve_timeout("DSB_TOOL_TIMEOUT=22\n") == 11.0


# ---- 结果形状 ----


def test_text_of_result_joins_text_blocks() -> None:
    result = {"content": [{"type": "text", "text": "一"}, {"type": "text", "text": "二"}]}
    assert text_of_result(result) == ("一\n\n二", False)


def test_text_of_result_keeps_the_is_error_flag() -> None:
    result = {"content": [{"type": "text", "text": "不行"}], "isError": True}
    assert text_of_result(result) == ("不行", True)


def test_text_of_result_dumps_whole_when_there_is_no_text_block() -> None:
    result = {"content": [{"type": "resource", "uri": "file:///x"}]}
    text, failed = text_of_result(result)
    assert json.loads(text) == result
    assert failed is False


# ---- 整链：起、列、转 ----


def test_gateway_starts_the_server_and_lists_prefixed_tools(gateway: Gateway) -> None:
    assert gateway.servers == ("fake",)
    tools = gateway.tools()
    assert [tool.name for tool in tools] == ["fake_echo"]
    assert tools[0].description == "[fake] 回声"
    assert tools[0].input_schema["type"] == "object"


def test_call_is_forwarded_and_text_passes_through(gateway: Gateway) -> None:
    payload, failed = gateway.tools()[0].handler({"text": "你好"})
    assert payload == {"text": "你好"}
    assert failed is False


def test_a_child_is_error_flows_through_as_failed(gateway: Gateway) -> None:
    _payload, failed = gateway.tools()[0].handler({"text": "iserr"})
    assert failed is True


def test_the_three_codes_of_the_book(gateway: Gateway) -> None:
    handler = gateway.tools()[0].handler
    # 底层协议层报错 → unexpected-response（它对模型的「话」走 isError，不走这儿）
    payload, failed = handler({"text": "boom"})
    assert ERROR_UNEXPECTED in payload["text"] and failed
    # 子进程没起 / 中途没了 → tool-not-running
    payload, failed = handler({"text": "die"})
    assert ERROR_NOT_RUNNING in payload["text"] and failed


def test_a_dead_server_restarts_on_the_next_call(gateway: Gateway) -> None:
    handler = gateway.tools()[0].handler
    handler({"text": "die"})
    payload, failed = handler({"text": "又活了"})
    assert (payload["text"], failed) == ("又活了", False)


def test_a_hanging_server_hits_the_deadline(fake_script: Path) -> None:
    gate = make_gateway(fake_script, timeout=0.4)
    try:
        payload, failed = gate.tools()[0].handler({"text": "hang"})
        assert ERROR_TIMEOUT in payload["text"] and failed
    finally:
        gate.stop()


def test_stop_takes_the_children_down(fake_script: Path) -> None:
    gate = make_gateway(fake_script)
    gate.stop()
    # 再停一次是幂等的，不许炸
    gate.stop()
