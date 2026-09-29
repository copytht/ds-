"""opencode HTTP 客户端：把现场折成 outcome 分支（网络与子进程一律 stub，不打真 opencode）。"""

from __future__ import annotations

import base64
import json
import subprocess
import urllib.error
from collections.abc import Callable
from typing import Any

from dsb.client import (
    OpencodeClient,
    ServiceUnavailable,
    fresh_messages,
    normalize_messages,
    outcome_from_exception,
    read_service,
)
from dsb.opencode import (
    ERROR_NOT_RUNNING,
    ERROR_TIMEOUT,
    ERROR_UNEXPECTED,
    payload_from_outcome,
)

HOST = "127.0.0.1"
PORT = 49374
PASSWORD = "test-password-not-a-real-secret"
SERVICE = {"host": HOST, "port": PORT, "password": PASSWORD}
BASELINE_MS = 1_000_000
SESSION = "ses_fixture"


class FakeResponse:
    """urlopen 返回物的替身：只需要当上下文管理器并交出响应体。"""

    def __init__(self, payload: Any = None, raw: bytes | None = None) -> None:
        self.raw = (
            raw
            if raw is not None
            else (b"" if payload is None else json.dumps(payload).encode("utf-8"))
        )

    def __enter__(self) -> FakeResponse:
        return self

    def __exit__(self, *exc: object) -> bool:
        return False

    def read(self) -> bytes:
        return self.raw


def live_messages(answer: str | None, *, old_answer: str = "上一轮的旧答案") -> dict[str, Any]:
    """一条真实形状（``type`` / ``content`` / ``time``）的消息响应体。"""
    data: list[dict[str, Any]] = [
        {
            "type": "assistant",
            "time": {"created": 1},
            "content": [{"type": "text", "text": old_answer}],
        },
        {"type": "user", "time": {"created": BASELINE_MS + 1}, "text": "问题正文"},
    ]
    if answer is not None:
        data.append(
            {
                "type": "assistant",
                "time": {"created": BASELINE_MS + 2},
                "content": [
                    {"type": "reasoning", "text": "想一想"},
                    {"type": "text", "text": answer},
                ],
            }
        )
    return {"data": data, "cursor": {"previous": None, "next": None}}


class Call:
    """一次出站请求的现场记录。"""

    def __init__(self, request: Any, timeout: float | None) -> None:
        self.method: str = request.method
        self.url: str = request.full_url
        self.timeout = timeout
        self.data: bytes | None = request.data
        self.authorization: str | None = request.get_header("Authorization")


class FakeOpen:
    """按 URL 分派预设响应的 urlopen 替身；顺手记下每次调用。"""

    def __init__(
        self,
        *,
        messages: dict[str, Any] | None = None,
        prompt: Any = None,
        prompt_error: BaseException | None = None,
        wait_error: BaseException | None = None,
        message_error: BaseException | None = None,
    ) -> None:
        self.messages = messages
        self.prompt = {"data": {"id": "inb_1"}} if prompt is None else prompt
        self.prompt_error = prompt_error
        self.wait_error = wait_error
        self.message_error = message_error
        self.calls: list[Call] = []

    def __call__(self, request: Any, timeout: float | None = None) -> FakeResponse:
        self.calls.append(Call(request, timeout))
        if request.full_url.endswith("/prompt"):
            if self.prompt_error is not None:
                raise self.prompt_error
            if isinstance(self.prompt, FakeResponse):
                return self.prompt
            return FakeResponse(self.prompt)
        if request.full_url.endswith("/wait"):
            if self.wait_error is not None:
                raise self.wait_error
            return FakeResponse()  # 204 空体
        if "/message" in request.full_url:
            if self.message_error is not None:
                raise self.message_error
            return FakeResponse(self.messages)
        raise AssertionError(f"没料到的请求：{request.full_url}")


def make_client(open_url: FakeOpen, **kwargs: Any) -> OpencodeClient:
    """带固定时钟的客户端：baseline 与 deadline 都可控。"""
    service_reader: Callable[[], dict[str, Any]] = kwargs.pop("service_reader", lambda: SERVICE)
    return OpencodeClient(
        SESSION,
        service_reader=service_reader,
        urlopen=open_url,
        wall_clock=lambda: BASELINE_MS / 1000,
        now=kwargs.pop("now", lambda: 0.0),
        sleep=kwargs.pop("sleep", lambda _seconds: None),
        **kwargs,
    )


def test_ask_returns_success_and_skips_the_previous_answer() -> None:
    open_url = FakeOpen(messages=live_messages("入口在 dsb/server.py。"))
    outcome = make_client(open_url).ask("repo 里 dsb 的入口在哪？")

    assert outcome["kind"] == "success"
    assert payload_from_outcome(outcome) == {
        "status": "ok",
        "answer": "入口在 dsb/server.py。",
    }
    methods = [call.method for call in open_url.calls]
    assert methods == ["POST", "POST", "GET"]  # prompt → wait → message
    expected = json.dumps({"text": "repo 里 dsb 的入口在哪？"}, ensure_ascii=False).encode()
    assert open_url.calls[0].data == expected
    assert open_url.calls[0].url.endswith(f"/api/session/{SESSION}/prompt")
    assert open_url.calls[1].url.endswith(f"/api/experimental/session/{SESSION}/wait")
    assert "/message?" in open_url.calls[2].url


def test_ask_sends_the_password_only_in_the_authorization_header() -> None:
    open_url = FakeOpen(messages=live_messages("答复"))
    make_client(open_url).ask("问题")

    for call in open_url.calls:
        assert call.url.startswith(f"http://{HOST}:{PORT}/")
        token = call.authorization or ""
        assert token.startswith("Basic ")
        assert base64.b64decode(token.removeprefix("Basic ")).decode() == f"opencode:{PASSWORD}"
        assert PASSWORD not in call.url  # 口令不进 URL、更不进日志
        assert PASSWORD not in (call.data or b"").decode()


def test_ask_reports_not_running_when_service_read_fails() -> None:
    open_url = FakeOpen()

    def boom() -> dict[str, Any]:
        raise ServiceUnavailable("opencode service status 现读失败")

    client = OpencodeClient(
        SESSION, service_reader=boom, urlopen=open_url, sleep=lambda _seconds: None
    )
    assert payload_from_outcome(client.ask("问题")) == {
        "status": "error",
        "error": ERROR_NOT_RUNNING,
    }
    assert open_url.calls == []  # 服务没跑，连 HTTP 都不发


def test_connection_refused_is_not_running_and_forces_a_reread() -> None:
    open_url = FakeOpen(prompt_error=urllib.error.URLError(ConnectionRefusedError("refused")))
    reads: list[int] = []

    def reader() -> dict[str, Any]:
        reads.append(1)
        return SERVICE

    client = make_client(open_url, service_reader=reader)
    assert payload_from_outcome(client.ask("问题")) == {
        "status": "error",
        "error": ERROR_NOT_RUNNING,
    }
    assert payload_from_outcome(client.ask("再问一次")) == {
        "status": "error",
        "error": ERROR_NOT_RUNNING,
    }
    assert len(reads) == 2  # 口令缓存被丢掉，第二次重新现读端口


def test_wait_timeout_maps_to_opencode_timeout() -> None:
    open_url = FakeOpen(wait_error=TimeoutError("timed out"))
    outcome = make_client(open_url).ask("问题")
    assert outcome == {"kind": "timeout"}
    assert payload_from_outcome(outcome) == {"status": "error", "error": ERROR_TIMEOUT}


def test_deadline_exhausted_maps_to_opencode_timeout() -> None:
    open_url = FakeOpen(messages=live_messages(None))  # 一直等不到带正文的答复
    clock = {"now": 0.0}

    def jump_after_sleep(_seconds: float) -> None:
        clock["now"] = 10_000.0  # 第一圈没等到答复，睡一觉起来已经过期

    client = make_client(
        open_url,
        queue_timeout=300.0,
        ask_timeout=120.0,
        now=lambda: clock["now"],
        sleep=jump_after_sleep,
    )
    assert payload_from_outcome(client.ask("问题")) == {
        "status": "error",
        "error": ERROR_TIMEOUT,
    }
    assert [call.method for call in open_url.calls] == ["POST", "POST", "GET"]


def test_busy_parent_conversation_does_not_eat_the_answer_budget() -> None:
    """主对话在忙时问题只能排队；排多久都不该吃掉答复该有的时间（真机 #14 的回归）。

    排队 500s 远超 ask_timeout=140 —— 改之前这里会直接判 timeout。
    """
    open_url = FakeOpen(messages=live_messages(None))  # 起初只有排队中的问题
    clock = {"now": 0.0}
    polls = {"n": 0}

    def sleep(_seconds: float) -> None:
        polls["n"] += 1
        if polls["n"] == 1:
            clock["now"] = 500.0  # 主对话忙了 500s，答复这才开写、正文还空着
            open_url.messages = live_messages("")
        else:
            clock["now"] = 520.0  # 答复又写了 20s
            open_url.messages = live_messages("答复正文")

    client = make_client(
        open_url,
        queue_timeout=600.0,
        ask_timeout=140.0,
        now=lambda: clock["now"],
        sleep=sleep,
    )
    assert payload_from_outcome(client.ask("问题")) == {"status": "ok", "answer": "答复正文"}


def test_queue_budget_exhausted_maps_to_opencode_timeout() -> None:
    """排到预算用完还没见 assistant 消息（主对话一直不空）→ 超时。"""
    open_url = FakeOpen(messages=live_messages(None))
    clock = {"now": 0.0}

    def jump_after_sleep(_seconds: float) -> None:
        clock["now"] = 10_000.0

    client = make_client(
        open_url,
        queue_timeout=600.0,
        ask_timeout=140.0,
        now=lambda: clock["now"],
        sleep=jump_after_sleep,
    )
    assert payload_from_outcome(client.ask("问题")) == {
        "status": "error",
        "error": ERROR_TIMEOUT,
    }


def test_answer_budget_starts_when_the_answer_starts() -> None:
    """答复一开写就换预算：正文一直空着，只给 ask_timeout 那 140s（不是 600s）。"""
    open_url = FakeOpen(messages=live_messages(""))  # assistant 消息在，正文始终空着
    clock = {"now": 0.0}

    def jump_after_sleep(_seconds: float) -> None:
        clock["now"] += 200.0  # 每圈都跳过答复预算

    client = make_client(
        open_url,
        queue_timeout=600.0,
        ask_timeout=140.0,
        now=lambda: clock["now"],
        sleep=jump_after_sleep,
    )
    assert payload_from_outcome(client.ask("问题")) == {
        "status": "error",
        "error": ERROR_TIMEOUT,
    }


def test_http_error_from_opencode_is_unexpected_response() -> None:
    error = urllib.error.HTTPError("http://127.0.0.1/", 500, "Server Error", None, None)
    open_url = FakeOpen(prompt_error=error)
    outcome = make_client(open_url).ask("问题")
    assert outcome == {"kind": "http-error", "status": 500}
    assert payload_from_outcome(outcome) == {"status": "error", "error": ERROR_UNEXPECTED}


def test_missing_session_id_never_calls_opencode() -> None:
    open_url = FakeOpen(messages=live_messages("答复"))
    client = OpencodeClient(None, service_reader=lambda: SERVICE, urlopen=open_url)
    assert payload_from_outcome(client.ask("问题")) == {
        "status": "error",
        "error": ERROR_UNEXPECTED,
    }
    assert open_url.calls == []


def test_unparsable_prompt_response_is_unexpected_response() -> None:
    open_url = FakeOpen(prompt=FakeResponse(raw="<html>不是 json</html>".encode()))
    assert payload_from_outcome(make_client(open_url).ask("问题")) == {
        "status": "error",
        "error": ERROR_UNEXPECTED,
    }


def test_unrecognised_message_body_is_unexpected_response() -> None:
    open_url = FakeOpen(messages={"note": "opencode 换了形状"})
    assert payload_from_outcome(make_client(open_url).ask("问题")) == {
        "status": "error",
        "error": ERROR_UNEXPECTED,
    }


def test_warm_up_reports_whether_the_service_was_readable() -> None:
    assert make_client(FakeOpen(messages=live_messages("答复"))).warm_up() is True

    def boom() -> dict[str, Any]:
        raise ServiceUnavailable("没起")

    client = OpencodeClient(SESSION, service_reader=boom, urlopen=FakeOpen())
    assert client.warm_up() is False


def test_read_service_parses_port_and_password() -> None:
    seen: list[list[str]] = []

    def run(argv: list[str], **_kwargs: Any) -> subprocess.CompletedProcess[str]:
        seen.append(argv)
        stdout = "http://127.0.0.1:49374\n" if argv[-1] == "status" else f"{PASSWORD}\n"
        return subprocess.CompletedProcess(argv, 0, stdout=stdout, stderr="")

    assert read_service(run) == {"host": HOST, "port": PORT, "password": PASSWORD}
    assert seen == [
        ["opencode", "service", "status"],
        ["opencode", "service", "get", "password"],
    ]


def test_read_service_rejects_a_dead_service() -> None:
    def stopped(argv: list[str], **_kwargs: Any) -> subprocess.CompletedProcess[str]:
        return subprocess.CompletedProcess(argv, 1, stdout="not running\n", stderr="")

    def missing(argv: list[str], **_kwargs: Any) -> subprocess.CompletedProcess[str]:
        raise FileNotFoundError(argv[0])

    for run in (stopped, missing):
        try:
            read_service(run)
        except ServiceUnavailable:
            pass
        else:
            raise AssertionError("服务没跑时应当抛 ServiceUnavailable")


def test_outcome_from_exception_classification() -> None:
    refused = urllib.error.URLError(ConnectionRefusedError("refused"))
    assert outcome_from_exception(refused) == {"kind": "not-running"}
    assert outcome_from_exception(ConnectionResetError()) == {"kind": "not-running"}
    assert outcome_from_exception(TimeoutError("t")) == {"kind": "timeout"}
    assert outcome_from_exception(urllib.error.URLError(TimeoutError("t"))) == {"kind": "timeout"}
    assert outcome_from_exception(ValueError("坏 json")) == {"kind": "unexpected"}


def test_normalize_live_shape_into_fixture_shape() -> None:
    body = live_messages("答复")
    messages = normalize_messages(body)
    assert messages is not None
    assert [message["role"] for message in messages] == ["assistant", "user", "assistant"]
    assert messages[1]["parts"] == [{"type": "text", "text": "问题正文"}]
    assert messages[2]["parts"][-1] == {"type": "text", "text": "答复"}


def test_normalize_rejects_shapes_it_does_not_recognise() -> None:
    assert normalize_messages({"note": "没有 data"}) is None
    assert normalize_messages("整段不是消息列表") is None
    assert normalize_messages({"data": "也不是列表"}) is None
    assert normalize_messages({"data": ["不是消息"]}) is None


def test_fresh_messages_filters_by_baseline_and_sorts_ascending() -> None:
    body = live_messages("答复")
    fresh = fresh_messages(body, BASELINE_MS)
    assert fresh is not None
    assert [message["role"] for message in fresh] == ["user", "assistant"]
    assert fresh_messages(body, BASELINE_MS + 10_000) == []
