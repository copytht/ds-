"""中继服务本身：起得来、一条 HTTP 往返拿到结构化载荷（send 一律 stub，不碰真 opencode）。"""

from __future__ import annotations

import json
import re
import threading
import urllib.error
import urllib.request
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import pytest

from dsb.client import DEFAULT_IDLE_TIMEOUT
from dsb.opencode import ERROR_NOT_RUNNING, ERROR_TIMEOUT, ERROR_UNEXPECTED
from dsb.server import (
    DEFAULT_PORT,
    make_server,
    parse_question,
    parse_send_request,
    resolve_idle_timeout,
    resolve_port,
    route,
)

HOST = "127.0.0.1"
OK_BODY = {
    "kind": "success",
    "body": [
        {
            "role": "assistant",
            "time": {"created": 2},
            "parts": [{"type": "text", "text": "入口在 dsb/server.py。"}],
        }
    ],
}


class StubSend:
    """替身 send：记下收到的问题，回预设的 outcome（或直接抛）。"""

    def __init__(self, outcome: Any = OK_BODY, error: BaseException | None = None) -> None:
        self.outcome = outcome
        self.error = error
        self.questions: list[str] = []
        self.session_ids: list[str | None] = []
        self.page_session_ids: list[str | None] = []

    def __call__(
        self,
        question: str,
        session_id: str | None = None,
        page_session_id: str | None = None,
    ) -> Any:
        self.questions.append(question)
        self.session_ids.append(session_id)
        self.page_session_ids.append(page_session_id)
        if self.error is not None:
            raise self.error
        return self.outcome


@pytest.fixture()
def serve() -> Iterator[Callable[..., str]]:
    """随机端口起中继；每个替身 send 一个端口，收摊时一起关。"""
    running: list[tuple[Any, threading.Thread]] = []

    def factory(send: Any, probe: Any = None, status: Any = None) -> str:
        server = make_server(send, host=HOST, port=0, probe=probe, status=status)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        running.append((server, thread))
        return f"http://{HOST}:{server.server_address[1]}"

    yield factory

    for server, thread in running:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


@pytest.fixture()
def relay(serve: Callable[..., str]) -> tuple[str, StubSend]:
    """一个普通中继：(base URL, send 替身)。"""
    send = StubSend()
    return serve(send), send


def request(url: str, *, method: str = "GET", body: bytes | None = None) -> tuple[int, dict]:
    """打一次中继，回 (HTTP 状态码, 解析后的 JSON 载荷)。"""
    req = urllib.request.Request(url, data=body, method=method)
    if body is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read())


def post_send(base: str, question: str = "问题") -> tuple[int, dict]:
    return request(f"{base}/send", method="POST", body=json.dumps({"question": question}).encode())


def test_health_endpoint_answers_ok(relay: tuple[str, StubSend]) -> None:
    base, _ask = relay
    assert request(f"{base}/health") == (200, {"status": "ok"})


@pytest.mark.parametrize("opencode", ["up", "down"])
def test_health_also_reports_opencode_liveness(serve: Callable[..., str], opencode: str) -> None:
    """中继活着不代表 opencode 活着——两件事出事时长得一模一样，分开了才好排查。"""
    base = serve(StubSend(), probe=lambda: opencode)
    assert request(f"{base}/health") == (200, {"status": "ok", "opencode": opencode})


def test_status_says_idle_when_nothing_is_in_flight(relay: tuple[str, StubSend]) -> None:
    base, _ask = relay
    assert request(f"{base}/status") == (200, {"status": "ok", "send": None})


def test_status_relays_the_in_flight_ask(serve: Callable[..., str]) -> None:
    """等待期的现场原样转述：阶段、已写字数、还剩多少预算。"""
    snapshot = {"phase": "writing", "written": 128, "remaining": 107.5}
    base = serve(StubSend(), status=lambda: {"status": "ok", "send": snapshot})
    assert request(f"{base}/status") == (200, {"status": "ok", "send": snapshot})


def test_one_round_trip_returns_ok_payload(relay: tuple[str, StubSend]) -> None:
    base, send = relay
    status, payload = post_send(base, "repo 里 dsb 的入口在哪？")

    assert status == 200
    assert payload == {"status": "ok", "answer": "入口在 dsb/server.py。"}
    assert send.questions == ["repo 里 dsb 的入口在哪？"]


def test_opencode_not_running_is_an_identifiable_error(
    serve: Callable[..., str],
) -> None:
    base = serve(StubSend(outcome={"kind": "not-running"}))
    assert post_send(base) == (200, {"status": "error", "error": ERROR_NOT_RUNNING})


@pytest.mark.parametrize(
    ("outcome", "expected"),
    [
        ({"kind": "timeout"}, ERROR_TIMEOUT),
        ({"kind": "http-error", "status": 500}, ERROR_UNEXPECTED),
    ],
)
def test_failure_outcomes_come_back_as_error_payloads(
    serve: Callable[..., str], outcome: dict[str, Any], expected: str
) -> None:
    base = serve(StubSend(outcome=outcome))
    assert post_send(base) == (200, {"status": "error", "error": expected})


def test_ask_that_blows_up_still_answers_json(serve: Callable[..., str]) -> None:
    base = serve(StubSend(error=RuntimeError("中继自己坏了")))
    assert post_send(base) == (500, {"status": "error", "error": ERROR_UNEXPECTED})


@pytest.mark.parametrize(
    "body",
    [b"", b"not json", b"[]", b"{}", json.dumps({"question": "   "}).encode()],
)
def test_bad_request_body_is_rejected_with_a_payload(
    relay: tuple[str, StubSend], body: bytes
) -> None:
    base, send = relay
    status, payload = request(f"{base}/send", method="POST", body=body)

    assert status == 400
    assert payload == {"status": "error", "error": ERROR_UNEXPECTED}
    assert send.questions == []


def test_unknown_path_is_a_payload_not_a_stack(relay: tuple[str, StubSend]) -> None:
    base, _ask = relay
    assert request(f"{base}/nope") == (404, {"status": "error", "error": ERROR_UNEXPECTED})


def test_preflight_allows_the_extension_origin(relay: tuple[str, StubSend]) -> None:
    base, _ask = relay
    req = urllib.request.Request(f"{base}/send", method="OPTIONS")
    with urllib.request.urlopen(req, timeout=10) as response:
        assert response.status == 204
        assert response.headers["Access-Control-Allow-Origin"] == "*"
        assert response.headers["Access-Control-Allow-Methods"] == "GET, POST, OPTIONS"


def test_route_is_pure_and_covers_every_path() -> None:
    send = StubSend()
    assert route("GET", "/health", b"", send) == (200, {"status": "ok"})
    assert route("GET", "/health", b"", send, probe=lambda: "up") == (
        200,
        {"status": "ok", "opencode": "up"},
    )
    assert route("GET", "/status?x=1", b"", send) == (200, {"status": "ok", "send": None})
    assert route("POST", "/send?x=1", json.dumps({"question": "问"}).encode(), send) == (
        200,
        {"status": "ok", "answer": "入口在 dsb/server.py。"},
    )
    assert route("GET", "/send", b"", send)[0] == 404
    assert route("GET", "/nope", b"", send)[0] == 404
    assert route("PUT", "/health", b"", send)[0] == 405
    assert send.questions == ["问"]


def test_parse_question_only_accepts_the_wire_shape() -> None:
    assert parse_question(json.dumps({"question": "问题"}).encode()) == "问题"
    assert parse_question(json.dumps({"question": " 多行\n问题 "}).encode()) == " 多行\n问题 "
    assert parse_question(json.dumps({"question": 42}).encode()) is None
    assert parse_question(json.dumps({"问题": "字段名反了"}).encode()) is None
    assert parse_question("中文不是 json".encode()) is None


def test_parse_send_request_takes_an_optional_poll_id_and_page_id() -> None:
    """id 让一趟长问句能被拆成几趟短轮询；page 让中继按页面会话分表（ADR-0005）。"""
    assert parse_send_request(json.dumps({"question": "问"}).encode()) == ("问", None, None)
    assert parse_send_request(json.dumps({"question": "问", "id": "q-1"}).encode()) == (
        "问",
        "q-1",
        None,
    )
    assert parse_send_request(json.dumps({"question": "问", "page": "abc"}).encode()) == (
        "问",
        None,
        "abc",
    )
    assert parse_send_request(
        json.dumps({"question": "问", "id": "q-1", "page": "abc"}).encode()
    ) == ("问", "q-1", "abc")
    assert parse_send_request(json.dumps({"question": "问", "id": ""}).encode()) is None
    assert parse_send_request(json.dumps({"question": "问", "id": 7}).encode()) is None
    assert parse_send_request(json.dumps({"question": "问", "page": ""}).encode()) is None
    assert parse_send_request(json.dumps({"question": "问", "page": 7}).encode()) is None


def test_route_hands_the_poll_id_and_page_id_through() -> None:
    send = StubSend()
    body = json.dumps({"question": "问", "id": "q-1", "page": "abc"}).encode()
    status, _ = route("POST", "/send", body, send)
    assert status == 200
    assert send.session_ids == ["q-1"]
    assert send.page_session_ids == ["abc"]


def test_resolve_port_prefers_the_process_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("DSB_PORT", "9123")
    assert resolve_port("DSB_PORT=4321") == 9123
    monkeypatch.delenv("DSB_PORT")
    assert resolve_port("DSB_PORT=4321") == 4321
    assert resolve_port("") == DEFAULT_PORT
    assert resolve_port("DSB_PORT=不是端口") == DEFAULT_PORT
    assert resolve_port("DSB_PORT=70000") == DEFAULT_PORT


def test_resolve_idle_timeout_prefers_the_process_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("DSB_IDLE_TIMEOUT", "30")
    assert resolve_idle_timeout("") == 30.0
    monkeypatch.delenv("DSB_IDLE_TIMEOUT")
    assert resolve_idle_timeout("DSB_IDLE_TIMEOUT=45.5") == 45.5
    assert resolve_idle_timeout("") == DEFAULT_IDLE_TIMEOUT
    assert resolve_idle_timeout("DSB_IDLE_TIMEOUT=不是秒数") == DEFAULT_IDLE_TIMEOUT
    assert resolve_idle_timeout("DSB_IDLE_TIMEOUT=-1") == DEFAULT_IDLE_TIMEOUT


def test_the_extension_timeout_outlives_the_relay_idle_window() -> None:
    """扩展侧的总兜底必须宽过中继判超时的那条线（静默窗口）。

    这两个数分处 TS 与 Python，没有共同的运行时事实来源，只能靠这条断言对齐：先到的
    必须是中继——它按静默判超时并折成 `opencode-timeout` 这个有信息量的码；扩展一旦先
    abort，报出来的只有没信息量的「中继不可达」，还会白扔一次正在跑的调用。
    """
    source = (Path(__file__).resolve().parents[1] / "src" / "lib" / "relay.ts").read_text(
        encoding="utf-8"
    )
    match = re.search(r"export const RELAY_TIMEOUT_MS = ([\d_]+)", source)
    assert match is not None, "src/lib/relay.ts 里找不到 RELAY_TIMEOUT_MS"
    extension_ms = int(match.group(1).replace("_", ""))

    worst_case_ms = int(DEFAULT_IDLE_TIMEOUT * 1000)
    # 留 120s 给中继自己的 HTTP 往返（读设置 / spawn / prompt / message / delete）
    assert extension_ms - worst_case_ms >= 120_000
