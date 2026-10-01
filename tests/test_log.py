"""业务日志：失败留得下、留得干净——正文进不来是**签名**保证的，不是自觉。"""

from __future__ import annotations

import json
import logging
import threading
import time
import urllib.error
import urllib.request
from collections.abc import Iterator
from typing import Any

import pytest

from dsb.log import SLOW_MS, log_event
from dsb.opencode import ERROR_NOT_RUNNING, ERROR_UNEXPECTED
from dsb.server import make_server

HOST = "127.0.0.1"
OK_BODY = {
    "kind": "success",
    "body": [
        {
            "role": "assistant",
            "time": {"created": 2},
            "parts": [{"type": "text", "text": "答复正文在这。"}],
        }
    ],
}


class StubSend:
    """替身 send：回预设的 outcome（或直接抛）。"""

    def __init__(self, outcome: Any = OK_BODY, error: BaseException | None = None) -> None:
        self.outcome = outcome
        self.error = error

    def __call__(
        self, question: str, session_id: str | None = None, page: str | None = None
    ) -> Any:
        if self.error is not None:
            raise self.error
        return self.outcome


@pytest.fixture()
def serve() -> Iterator[Any]:
    """随机端口起中继；收摊时一起关。"""
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


@pytest.fixture(autouse=True)
def events(caplog: pytest.LogCaptureFixture) -> Iterator[pytest.LogCaptureFixture]:
    """每个用例都从干净的捕获开始，免得上一条的尾巴被当成本条的证据。"""
    caplog.set_level(logging.INFO, logger="dsb")
    caplog.clear()
    yield caplog


def request(url: str, *, method: str = "GET", body: bytes | None = None) -> tuple[int, dict]:
    req = urllib.request.Request(url, data=body, method=method)
    if body is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read())


def post_send(base: str, question: str = "问题正文在这") -> tuple[int, dict]:
    return request(f"{base}/send", method="POST", body=json.dumps({"question": question}).encode())


def test_question_text_cannot_be_logged_because_it_is_not_in_the_signature() -> None:
    """结构性保证：调用点想记正文都写不出参数来。"""
    with pytest.raises(TypeError):
        log_event("send-ok", question="问题正文")  # pyright: ignore[reportCallIssue]
    with pytest.raises(TypeError):
        log_event("send-ok", answer="答复正文")  # pyright: ignore[reportCallIssue]


def test_event_line_names_the_event_and_its_fields(events: pytest.LogCaptureFixture) -> None:
    log_event("send-fail", error=ERROR_NOT_RUNNING, took_ms=1234.4)
    assert "send-fail error=opencode-not-running took_ms=1234" in events.text


def test_an_exception_keeps_only_its_type_name(events: pytest.LogCaptureFixture) -> None:
    """异常消息里可能嵌着用户的东西，只留类型名。"""
    log_event("send-broke", path="/send", exc=RuntimeError("问题正文"))
    assert "send-broke path=/send" in events.text
    assert "RuntimeError" in events.text
    assert "问题正文" not in events.text


def test_a_failed_ask_leaves_its_error_code_and_duration(
    serve: Any, events: pytest.LogCaptureFixture
) -> None:
    base = serve(StubSend(outcome={"kind": "not-running"}))
    assert post_send(base)[1] == {"status": "error", "error": ERROR_NOT_RUNNING}
    assert "send-fail error=opencode-not-running" in events.text
    assert "took_ms=" in events.text


def test_a_successful_ask_leaves_a_length_not_a_body(
    serve: Any, events: pytest.LogCaptureFixture
) -> None:
    """成功也记一条——「问过、答了、花了多久」是这条链上最有信息量的正常事件。"""
    base = serve(StubSend())
    status, payload = post_send(base, "问题正文在这")

    assert status == 200 and payload["status"] == "ok"
    assert "send-ok" in events.text
    assert "answer_chars=" in events.text
    assert "问题正文" not in events.text
    assert "答复正文" not in events.text


def test_a_pending_poll_is_not_logged_as_an_answer(
    serve: Any, events: pytest.LogCaptureFixture
) -> None:
    """长问句的中间态（一趟没等到）不是失败也不是答完，别往日志里灌。"""
    base = serve(StubSend(outcome={"kind": "pending", "id": "q-1"}))
    status, payload = post_send(base)

    assert status == 200 and payload == {"status": "pending", "id": "q-1"}
    assert "send-ok" not in events.text
    assert "send-fail" not in events.text


def test_a_probe_that_blows_up_answers_json_and_keeps_its_name(
    serve: Any, events: pytest.LogCaptureFixture
) -> None:
    """探活抛异常以前是裸断连（扩展眼里长得像「中继死了」），现在既回响应又留名。"""

    def boom() -> str:
        raise RuntimeError("探活炸了")

    base = serve(StubSend(), probe=boom)
    assert request(f"{base}/health") == (500, {"status": "error", "error": ERROR_UNEXPECTED})
    assert "probe-broke" in events.text
    assert "RuntimeError" in events.text
    assert "探活炸了" not in events.text


def test_a_slow_probe_is_recorded_a_fast_one_is_not(
    serve: Any, events: pytest.LogCaptureFixture
) -> None:
    """探活慢了就是翻红的前兆（扩展只给 5s）；正常那条记下来只是噪音。"""
    fast = serve(StubSend(), probe=lambda: "up")
    request(f"{fast}/health")
    assert "slow" not in events.text

    def slow() -> str:
        time.sleep((SLOW_MS + 50) / 1000)
        return "up"

    slow_base = serve(StubSend(), probe=slow)
    request(f"{slow_base}/health")
    assert "slow path=/health took_ms=" in events.text


def test_a_request_that_breaks_the_wire_shape_is_recorded(
    serve: Any, events: pytest.LogCaptureFixture
) -> None:
    base = serve(StubSend())
    assert request(f"{base}/nope")[0] == 404
    assert "bad-request path=/nope http=404" in events.text
