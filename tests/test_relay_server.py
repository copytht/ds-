"""中继服务本身：起得来、一条 HTTP 往返拿到结构化载荷（ask 一律 stub，不碰真 opencode）。"""

from __future__ import annotations

import json
import threading
import urllib.error
import urllib.request
from collections.abc import Callable, Iterator
from typing import Any

import pytest

from dsb.client import DEFAULT_ASK_TIMEOUT
from dsb.opencode import ERROR_NOT_RUNNING, ERROR_TIMEOUT, ERROR_UNEXPECTED
from dsb.server import (
    DEFAULT_PORT,
    make_server,
    parse_question,
    resolve_ask_timeout,
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


class StubAsk:
    """替身 ask：记下收到的问题，回预设的 outcome（或直接抛）。"""

    def __init__(self, outcome: Any = OK_BODY, error: BaseException | None = None) -> None:
        self.outcome = outcome
        self.error = error
        self.questions: list[str] = []

    def __call__(self, question: str) -> Any:
        self.questions.append(question)
        if self.error is not None:
            raise self.error
        return self.outcome


@pytest.fixture()
def serve() -> Iterator[Callable[..., str]]:
    """随机端口起中继；每个替身 ask 一个端口，收摊时一起关。"""
    running: list[tuple[Any, threading.Thread]] = []

    def factory(ask: Any) -> str:
        server = make_server(ask, host=HOST, port=0)
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
def relay(serve: Callable[..., str]) -> tuple[str, StubAsk]:
    """一个普通中继：(base URL, ask 替身)。"""
    ask = StubAsk()
    return serve(ask), ask


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


def post_ask(base: str, question: str = "问题") -> tuple[int, dict]:
    return request(f"{base}/ask", method="POST", body=json.dumps({"question": question}).encode())


def test_health_endpoint_answers_ok(relay: tuple[str, StubAsk]) -> None:
    base, _ask = relay
    assert request(f"{base}/health") == (200, {"status": "ok"})


def test_one_round_trip_returns_ok_payload(relay: tuple[str, StubAsk]) -> None:
    base, ask = relay
    status, payload = post_ask(base, "repo 里 dsb 的入口在哪？")

    assert status == 200
    assert payload == {"status": "ok", "answer": "入口在 dsb/server.py。"}
    assert ask.questions == ["repo 里 dsb 的入口在哪？"]


def test_opencode_not_running_is_an_identifiable_error(
    serve: Callable[..., str],
) -> None:
    base = serve(StubAsk(outcome={"kind": "not-running"}))
    assert post_ask(base) == (200, {"status": "error", "error": ERROR_NOT_RUNNING})


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
    base = serve(StubAsk(outcome=outcome))
    assert post_ask(base) == (200, {"status": "error", "error": expected})


def test_ask_that_blows_up_still_answers_json(serve: Callable[..., str]) -> None:
    base = serve(StubAsk(error=RuntimeError("中继自己坏了")))
    assert post_ask(base) == (500, {"status": "error", "error": ERROR_UNEXPECTED})


@pytest.mark.parametrize(
    "body",
    [b"", b"not json", b"[]", b"{}", json.dumps({"question": "   "}).encode()],
)
def test_bad_request_body_is_rejected_with_a_payload(
    relay: tuple[str, StubAsk], body: bytes
) -> None:
    base, ask = relay
    status, payload = request(f"{base}/ask", method="POST", body=body)

    assert status == 400
    assert payload == {"status": "error", "error": ERROR_UNEXPECTED}
    assert ask.questions == []


def test_unknown_path_is_a_payload_not_a_stack(relay: tuple[str, StubAsk]) -> None:
    base, _ask = relay
    assert request(f"{base}/nope") == (404, {"status": "error", "error": ERROR_UNEXPECTED})


def test_preflight_allows_the_extension_origin(relay: tuple[str, StubAsk]) -> None:
    base, _ask = relay
    req = urllib.request.Request(f"{base}/ask", method="OPTIONS")
    with urllib.request.urlopen(req, timeout=10) as response:
        assert response.status == 204
        assert response.headers["Access-Control-Allow-Origin"] == "*"
        assert response.headers["Access-Control-Allow-Methods"] == "GET, POST, OPTIONS"


def test_route_is_pure_and_covers_every_path() -> None:
    ask = StubAsk()
    assert route("GET", "/health", b"", ask) == (200, {"status": "ok"})
    assert route("POST", "/ask?x=1", json.dumps({"question": "问"}).encode(), ask) == (
        200,
        {"status": "ok", "answer": "入口在 dsb/server.py。"},
    )
    assert route("GET", "/ask", b"", ask)[0] == 404
    assert route("PUT", "/health", b"", ask)[0] == 405
    assert ask.questions == ["问"]


def test_parse_question_only_accepts_the_wire_shape() -> None:
    assert parse_question(json.dumps({"question": "问题"}).encode()) == "问题"
    assert parse_question(json.dumps({"question": " 多行\n问题 "}).encode()) == " 多行\n问题 "
    assert parse_question(json.dumps({"question": 42}).encode()) is None
    assert parse_question(json.dumps({"问题": "字段名反了"}).encode()) is None
    assert parse_question("中文不是 json".encode()) is None


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


def test_resolve_ask_timeout_prefers_the_process_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("DSB_ASK_TIMEOUT", "30")
    assert resolve_ask_timeout("") == 30.0
    monkeypatch.delenv("DSB_ASK_TIMEOUT")
    assert resolve_ask_timeout("DSB_ASK_TIMEOUT=45.5") == 45.5
    assert resolve_ask_timeout("") == DEFAULT_ASK_TIMEOUT
    assert resolve_ask_timeout("DSB_ASK_TIMEOUT=不是秒数") == DEFAULT_ASK_TIMEOUT
    assert resolve_ask_timeout("DSB_ASK_TIMEOUT=-1") == DEFAULT_ASK_TIMEOUT
