"""opencode HTTP 客户端：把现场折成 outcome 分支（网络与子进程一律 stub，不打真 opencode）。"""

from __future__ import annotations

import base64
import json
import subprocess
import threading
import time
import urllib.error
from collections.abc import Callable
from types import SimpleNamespace
from typing import Any

from dsb.client import (
    CHILD_ROLE,
    CHILD_TITLE,
    CONTINUE_ROLE,
    OpencodeClient,
    ServiceUnavailable,
    answer_prompt,
    fresh_messages,
    normalize_messages,
    outcome_from_exception,
    read_service,
)
from dsb.events import DRAIN_FIRST_WAIT_SECONDS, DRAIN_QUIET_SECONDS
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
CHILD = "ses_child_spawned"
#: 替身心跳的间隔：要比 `DRAIN_QUIET_SECONDS` 慢（否则 drain 永远收不拢），
#: 又要比 `DRAIN_FIRST_WAIT_SECONDS` 快（否则 drain 等不到它）。
BEAT_PERIOD_SECONDS = 0.1


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


def working_messages(reasoning: str) -> dict[str, Any]:
    """「在干活但还没答完」的消息体：assistant 在长 reasoning，正文还没落地。

    用来验「在动就不算超时」——形状每轮都变（reasoning 在长），但
    :func:`dsb.opencode.extract_answer` 仍拿不到正文。
    """
    return {
        "data": [
            {"type": "user", "time": {"created": BASELINE_MS + 1}, "text": "问题正文"},
            {
                "type": "assistant",
                "time": {"created": BASELINE_MS + 2},
                "content": [{"type": "reasoning", "text": reasoning}],
            },
        ],
        "cursor": {"previous": None, "next": None},
    }


class Call:
    """一次出站请求的现场记录。"""

    def __init__(self, request: Any, timeout: float | None) -> None:
        # get_method() 而不是 .method：没显式传 method 的 Request 上没有那个属性。
        self.method: str = request.get_method()
        self.url: str = request.full_url
        self.timeout = timeout
        self.data: bytes | None = request.data
        self.authorization: str | None = request.get_header("Authorization")


class FakeSocket:
    """``/api/event`` 那条连接的 socket 替身：握手后要把读改成无限等。

    老写法把读超时留着，真机上超时一次就把 ``http.client`` 的缓冲读废了
    （``cannot read from timed out object``），于是第一圈安静就把流判死。
    所以这里记下 ``settimeout(None)`` 到底有没有被调用。
    """

    def __init__(self) -> None:
        self.timeout: float | None = 0.5  # 握手超时的默认值，等着被改掉
        self.shutdown_how: int | None = None

    def settimeout(self, value: float | None) -> None:
        self.timeout = value

    def shutdown(self, how: int) -> None:
        self.shutdown_how = how


class FakeEvents:
    """``/api/event`` 的替身：交出预设的行，交完就每轮给一拍心跳再安静下去。

    默认 ``beats=True`` 模拟「连着、只是这一阵没事件」——真机上 opencode 每 15s
    吐一拍心跳，所以安静不等于死；``beats=False`` 才是「心跳也停了」，用来验停摆判死。
    ``dies=True`` 模拟对面收摊（EOF），用来验「断流当场判死」。

    ``fp.raw._sock`` 是照着 ``http.client`` 长的：认不出 socket 的话
    ``_open_events`` 会当场放弃这条流，等待退化成阻塞 wait——替身不长这样，
    生产那条路就等于一条都没测到。
    """

    def __init__(
        self, lines: list[bytes] | None = None, *, dies: bool = False, beats: bool = True
    ) -> None:
        self.lines = list(lines or [])
        self.dies = dies
        self.beats = beats
        self._stalled = threading.Event()
        self.closed = False
        self.socket = FakeSocket()
        self.fp = SimpleNamespace(raw=SimpleNamespace(_sock=self.socket))

    def readline(self) -> bytes:
        if self.lines:
            return self.lines.pop(0)
        if self.dies:
            return b""  # EOF：opencode 没了
        if not self.beats:
            self._stalled.wait()  # 心跳也停了：堵在读上不放行，等它被判停摆
            return b""
        # 真机上心跳 15s 一拍；这里压到 0.1s 一拍——`_last_byte` 记的是**注入的**
        # 假时钟，跳远之后必须真有一拍到手，否则「模型 500s 才开工」会被误判成停摆。
        time.sleep(BEAT_PERIOD_SECONDS)
        return b": heartbeat\n"

    def close(self) -> None:
        self.closed = True
        self._stalled.set()  # 收摊要能把堵在读上的线程叫醒


def sse(*payloads: dict[str, Any]) -> list[bytes]:
    """事件 dict 列表 → SSE 的原始行（每条一个 ``data:`` 加一个空行）。"""
    lines: list[bytes] = []
    for payload in payloads:
        lines.append(f"data: {json.dumps(payload, ensure_ascii=False)}\n".encode())
        lines.append(b"\n")
    return lines


def child_event(kind: str, **data: Any) -> dict[str, Any]:
    """一个属于本子会话的事件（sessionID 用 fixture 里 spawn 出来的那个）。"""
    return {"id": f"evt_{kind}", "type": kind, "data": {"sessionID": CHILD, **data}}


class FakeOpen:
    """按 URL 分派预设响应的 urlopen 替身；顺手记下每次调用。"""

    def __init__(
        self,
        *,
        messages: dict[str, Any] | None = None,
        prompt: Any = None,
        prompt_error: BaseException | None = None,
        prompt_hook: Callable[[], None] | None = None,
        wait_error: BaseException | None = None,
        message_error: BaseException | None = None,
        parent: Any = None,
        spawn: Any = None,
        spawn_error: BaseException | None = None,
        delete_error: BaseException | None = None,
        child_error: BaseException | None = None,
        interrupt_error: BaseException | None = None,
        events: FakeEvents | None = None,
        events_error: BaseException | None = None,
        active_error: BaseException | None = None,
    ) -> None:
        self.messages = messages
        self.prompt = {"data": {"id": "inb_1"}} if prompt is None else prompt
        self.prompt_error = prompt_error
        self.prompt_hook = prompt_hook  # prompt 时现场要做点别的（并发用例卡在这儿）
        self.wait_error = wait_error
        self.message_error = message_error
        # 事件流默认「活着但安静」：这就是生产的主路径（挂得上、一时半会没事件）。
        # 挂不上要显式给 events_error，等待会退化成阻塞 wait。
        self.events = FakeEvents() if events is None else events
        self.events_error = events_error
        self.active_error = active_error
        # 父会话身上借来的设置（agent / model / 目录），spawn 全靠它组装请求体
        self.parent = (
            {
                "data": {
                    "agent": "build",
                    "model": {"providerID": "opencode", "id": "mimo-v2.6-flash-free"},
                    "location": {"directory": "/repo"},
                }
            }
            if parent is None
            else parent
        )
        self.spawn = {"data": {"id": CHILD}} if spawn is None else spawn
        self.spawn_error = spawn_error
        self.delete_error = delete_error
        # 复用子会话前的那次探活（GET /api/session/{CHILD}）与掐轮次的现场
        self.child_error = child_error
        self.interrupt_error = interrupt_error
        self.calls: list[Call] = []

    def __call__(self, request: Any, timeout: float | None = None) -> FakeResponse:
        self.calls.append(Call(request, timeout))
        if request.method == "GET" and request.full_url.endswith(f"/api/session/{SESSION}"):
            return FakeResponse(self.parent)
        if request.method == "GET" and request.full_url.endswith(f"/api/session/{CHILD}"):
            if self.child_error is not None:
                raise self.child_error
            return FakeResponse({"data": {"id": CHILD}})  # 会话还在，可以复用
        if request.method == "POST" and request.full_url.endswith("/api/session"):
            if self.spawn_error is not None:
                raise self.spawn_error
            return FakeResponse(self.spawn)
        if request.method == "DELETE":
            if self.delete_error is not None:
                raise self.delete_error
            return FakeResponse()
        if request.full_url.endswith("/interrupt"):
            if self.interrupt_error is not None:
                raise self.interrupt_error
            return FakeResponse({"interrupted": True})
        if request.full_url.endswith("/prompt"):
            if self.prompt_error is not None:
                raise self.prompt_error
            if self.prompt_hook is not None:
                self.prompt_hook()
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
        if request.full_url.endswith("/api/event"):
            if self.events_error is not None:
                raise self.events_error
            return self.events
        if request.full_url.endswith("/api/session/active"):
            if self.active_error is not None:
                raise self.active_error
            return FakeResponse({"data": {"ses_running": {"type": "running"}}})
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
    assert methods == ["GET", "POST", "GET", "POST", "GET"]
    # 读父会话设置 → spawn 空子会话 → 挂事件流 → prompt → message
    # （事件流抢在 prompt 之前，晚一步就吃不到 execution.started；
    #   尾巴那条 DELETE 不在这儿：子会话是活期间一直复用的，收摊才删）
    assert open_url.calls[0].method == "GET"
    assert open_url.calls[0].url.endswith(f"/api/session/{SESSION}")
    assert open_url.calls[1].method == "POST"
    assert open_url.calls[1].url.endswith("/api/session")
    assert open_url.calls[2].url.endswith("/api/event")
    assert open_url.calls[3].url.endswith(f"/api/session/{CHILD}/prompt")
    assert "/message?" in open_url.calls[4].url


def test_spawned_child_inherits_settings_but_never_history() -> None:
    """子会话只借 agent / model / 工作目录（dsh 的 spawn），绝不复制主对话历史。

    委派链上的父级是网页那边的模型，历史在它那边；本机主对话是另一个 agent，
    走 fork 就等于把无关上下文塞给子 agent。这里把「不走 /fork」钉成回归。
    """
    open_url = FakeOpen(messages=live_messages("答复"))
    make_client(open_url).ask("问题")

    assert not any(call.url.endswith("/fork") for call in open_url.calls)
    created = json.loads(open_url.calls[1].data.decode("utf-8"))
    assert created == {
        "title": CHILD_TITLE,
        "agent": "build",
        "model": {"providerID": "opencode", "id": "mimo-v2.6-flash-free"},
        "location": {"directory": "/repo"},
    }


def test_spawn_without_an_id_is_an_unexpected_response() -> None:
    """spawn 拿不到子会话 id → 非预期响应，不该静默把问题塞回主对话。"""
    open_url = FakeOpen(spawn={"data": {"note": "没有 id"}})
    outcome = make_client(open_url).ask("问题")

    assert payload_from_outcome(outcome) == {
        "status": "error",
        "error": ERROR_UNEXPECTED,
    }
    assert not any(c.url.endswith("/prompt") for c in open_url.calls)


def test_spawn_connection_loss_is_not_running() -> None:
    open_url = FakeOpen(spawn_error=urllib.error.URLError(ConnectionRefusedError("没起")))
    outcome = make_client(open_url).ask("问题")
    assert outcome == {"kind": "not-running"}
    assert payload_from_outcome(outcome) == {"status": "error", "error": ERROR_NOT_RUNNING}


def test_ask_never_prompts_the_main_conversation() -> None:
    """主 agent 是页面上的模型；本机这条主对话绝不被 prompt、也不阻塞。

    它在这条链上只有一处被 GET：读 agent/model/目录这三项设置，没有任何对话内容
    被读走，也没有任何等待落在它身上（子会话是新起的，跟它无关）。
    """
    open_url = FakeOpen(messages=live_messages("答复"))
    make_client(open_url).ask("问题")

    reads = [c for c in open_url.calls if c.url.endswith(f"/api/session/{SESSION}")]
    assert [c.method for c in reads] == ["GET"]
    assert not any(c.url.endswith(f"/api/session/{SESSION}/prompt") for c in open_url.calls)
    assert not any(f"/api/session/{SESSION}/wait" in c.url for c in open_url.calls)


def test_a_failed_answer_interrupts_the_turn_but_keeps_the_child() -> None:
    """没答成：掐掉这一轮，子会话**留着**——可继续子级下一轮还要用。

    掐的是轮次不是会话：超时时它多半还在写，不掐的话下一问会被 steer 进这半个轮次里。
    """
    open_url = FakeOpen(messages=live_messages(None), message_error=TimeoutError("boom"))
    outcome = make_client(open_url).ask("问题")

    assert outcome["kind"] == "timeout"
    assert open_url.calls[-1].method == "POST"
    assert open_url.calls[-1].url.endswith(f"/api/session/{CHILD}/interrupt")
    assert not any(c.method == "DELETE" for c in open_url.calls)  # 会话没被删


def test_failing_to_dispose_the_child_at_shutdown_does_not_raise() -> None:
    """收摊删不掉只该被吞掉：这一步从来不该把进程退出变成一场异常。"""
    open_url = FakeOpen(messages=live_messages("答复"), delete_error=OSError("删不掉"))
    client = make_client(open_url)
    assert payload_from_outcome(client.ask("问题")) == {"status": "ok", "answer": "答复"}

    client.dispose()  # 不外抛
    assert open_url.calls[-1].method == "DELETE"
    assert open_url.calls[-1].url.endswith(f"/api/session/{CHILD}")


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
    """事件流挂不上时退回阻塞 wait（老路），它等超时照旧折成 opencode-timeout。"""
    open_url = FakeOpen(wait_error=TimeoutError("timed out"), events_error=OSError("挂不上"))
    outcome = make_client(open_url).ask("问题")
    assert outcome == {"kind": "timeout"}
    assert payload_from_outcome(outcome) == {"status": "error", "error": ERROR_TIMEOUT}
    assert any(c.url.endswith("/wait") for c in open_url.calls)  # 退化路确实走了 wait


def test_deadline_exhausted_maps_to_opencode_timeout() -> None:
    open_url = FakeOpen(messages=live_messages(None))  # 一直等不到带正文的答复
    clock = {"now": 0.0}

    def jump_after_sleep(_seconds: float) -> None:
        clock["now"] = 10_000.0  # 第一圈没等到答复，睡一觉起来静默早就过了

    client = make_client(
        open_url,
        idle_timeout=240.0,
        now=lambda: clock["now"],
        sleep=jump_after_sleep,
    )
    assert payload_from_outcome(client.ask("问题")) == {
        "status": "error",
        "error": ERROR_TIMEOUT,
    }
    # 尾巴那一下是**掐轮次**（没答成），不是删会话——会话要留着给下一问复用
    assert [call.method for call in open_url.calls] == [
        "GET",
        "POST",
        "GET",
        "POST",
        "GET",
        "POST",
    ]
    assert open_url.calls[-1].url.endswith(f"/api/session/{CHILD}/interrupt")


def test_child_prompt_carries_the_role_frame() -> None:
    """子会话空着出生，角色框把「没有此前的对话」讲清楚，让它只答问题本身。"""
    open_url = FakeOpen(messages=live_messages("答复"))
    make_client(open_url).ask("超时怎么修？")

    sent = json.loads(open_url.calls[3].data.decode("utf-8"))  # 0父 1spawn 2事件流 3prompt
    assert "超时怎么修？" in sent["text"]
    assert sent["text"].startswith(CHILD_ROLE)
    assert sent["text"] == answer_prompt("超时怎么修？")


# ------------------------------------------------------- 可继续子级（反复调用）


def test_later_questions_reuse_the_child_and_get_the_followup_frame() -> None:
    """第二问起复用同一个子会话（dsh 的 continuable），并按「续问」来框。

    复用就是这套机制的全部意义：后期会被反复调用，上一轮的问答要留给下一轮当上下文。
    所以三件事一起钉——不重起、不删，且**先等空闲再送进去**（忙时 prompt 是 steer）。
    """
    open_url = FakeOpen(messages=live_messages("答复"))
    client = make_client(open_url)

    assert client.ask("第一问")["kind"] == "success"
    assert client.ask("第二问")["kind"] == "success"

    spawns = [c for c in open_url.calls if c.method == "POST" and c.url.endswith("/api/session")]
    assert len(spawns) == 1  # 子会话只起一次
    assert not any(c.method == "DELETE" for c in open_url.calls)  # 活期间不删

    prompts = [c for c in open_url.calls if c.url.endswith("/prompt")]
    first = json.loads(prompts[0].data.decode("utf-8"))
    second = json.loads(prompts[1].data.decode("utf-8"))
    assert first["text"] == answer_prompt("第一问")  # 空着出生：还是首问那个框
    assert second["text"] == answer_prompt("第二问", followup=True)
    assert second["text"].startswith(CONTINUE_ROLE)

    waits = [i for i, c in enumerate(open_url.calls) if c.url.endswith("/wait")]
    assert len(waits) == 1  # 首问不用等（新会话恒空闲），只有复用那次要等
    assert waits[0] < open_url.calls.index(prompts[1])  # 且必须抢在送进去之前


def test_waiting_for_the_previous_turn_is_bounded_by_the_idle_window() -> None:
    """复用前「等上一轮收干净」也有个界，吃的是这一问进门划的静默窗口。

    等空闲不能无限等：上一轮的尾巴再长，也不能让这一问永远进不去。界限一到就掐掉那
    一轮继续（掐掉安全：那一轮的答复早已交出去）。这里钉的是**它确实带上了那个超时**。
    """
    open_url = FakeOpen(messages=live_messages("答复"))
    client = make_client(open_url, idle_timeout=120.0)
    assert client.ask("第一问")["kind"] == "success"  # 新会话恒空闲，不用等
    assert client.ask("第二问")["kind"] == "success"  # 复用：先等空闲再送进去

    waits = [call for call in open_url.calls if call.url.endswith("/wait")]
    assert len(waits) == 1
    assert waits[0].timeout == 120.0  # 静默窗口原样交给这次 wait


def test_a_vanished_child_is_respawned() -> None:
    """子会话没了（被人删过、或 opencode 换过实例）：下次问认出来就重起一个。"""
    open_url = FakeOpen(messages=live_messages("答复"))
    client = make_client(open_url)
    assert client.ask("第一问")["kind"] == "success"

    open_url.child_error = urllib.error.HTTPError(
        f"http://127.0.0.1/api/session/{CHILD}", 404, "Not Found", None, None
    )
    assert client.ask("第二问")["kind"] == "success"

    spawns = [c for c in open_url.calls if c.method == "POST" and c.url.endswith("/api/session")]
    assert len(spawns) == 2  # 复用前的探活报 404 → 当场重起


def test_a_parent_without_the_three_settings_fails_loudly(caplog: Any) -> None:
    """缺 agent/model/location 当场报错：不再每问干等 120s，也不再静默写错工作目录。

    报错之外还要**落一行痕**：页面只拿得到 ``unexpected-response``，日志里得看得出缺的
    是那样，否则事后还得自己去 GET 父会话。
    """
    for missing in ("agent", "model", "location"):
        caplog.clear()
        settings: dict[str, Any] = {
            "agent": "build",
            "model": {"providerID": "opencode", "id": "mimo-v2.6-flash-free"},
            "location": {"directory": "/repo"},
        }
        settings.pop(missing)
        open_url = FakeOpen(parent={"data": settings}, messages=live_messages("答复"))

        with caplog.at_level("INFO", logger="dsb"):
            assert payload_from_outcome(make_client(open_url).ask("问题")) == {
                "status": "error",
                "error": ERROR_UNEXPECTED,
            }
        got = [r.getMessage() for r in caplog.records if "spawn-missing" in r.getMessage()]
        assert got == [f"spawn-missing missing={missing}"]
        assert not any(c.url.endswith("/prompt") for c in open_url.calls)
        assert not any(
            c.method == "POST" and c.url.endswith("/api/session") for c in open_url.calls
        )


def test_two_asks_queue_instead_of_sharing_one_turn() -> None:
    """一个子会话同时只接一轮：后到的问句在锁上等，不被 steer 进前一轮里。

    排法靠现场卡位：A 进到 prompt 就堵住，等 B 敲门，再留 0.2s。没锁的话 B 这 0.2s 里
    早就把整趟（验活 → 等空闲 → prompt → 取答复）走完了，于是两个 prompt 挤在同一轮里。
    """
    a_prompting = threading.Event()
    b_in = threading.Event()

    def hook() -> None:
        if threading.current_thread().name != "ask-a":
            return  # 后到的那个没什么好等的：它本就该在 A 收工之后才动手
        a_prompting.set()
        b_in.wait(timeout=5)
        time.sleep(0.2)

    open_url = FakeOpen(
        messages=live_messages("答复"),
        events_error=OSError("挂不上"),  # 事件流缺席：等待退化成阻塞 wait，两轮都够快
        prompt_hook=hook,
    )
    client = make_client(open_url)
    results: dict[str, Any] = {}

    def ask_a() -> None:
        results["a"] = client.ask("第一问")

    def ask_b() -> None:
        a_prompting.wait(timeout=5)
        b_in.set()
        results["b"] = client.ask("第二问")

    threads = [
        threading.Thread(target=ask_a, name="ask-a"),
        threading.Thread(target=ask_b, name="ask-b"),
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)
    assert all(not thread.is_alive() for thread in threads)
    assert results["a"]["kind"] == "success"
    assert results["b"]["kind"] == "success"

    turns = [
        "prompt" if c.url.endswith("/prompt") else "answer" if "/message" in c.url else None
        for c in open_url.calls
    ]
    # 两轮必须一头一尾串着：连着两个 prompt 就是第二问被 steer 进了第一轮。
    assert [turn for turn in turns if turn] == ["prompt", "answer", "prompt", "answer"]
    spawns = [c for c in open_url.calls if c.method == "POST" and c.url.endswith("/api/session")]
    assert len(spawns) == 1  # 两个问句共用同一个子会话


def test_a_long_working_turn_is_not_cut_while_it_keeps_working() -> None:
    """在动就不算超时：opencode 一路有动静，总时长远超单个静默窗口也不算超时。

    真机对照：一轮审阅跑了 268s（按老的两段墙钟，写答复那段只剩约 45s）。这里每圈推进
    现场（reasoning 在长 = 在动）并让时钟走掉 200s（< 静默窗口 240s），攒到 800s 仍要问成。
    """
    open_url = FakeOpen(messages=live_messages(None))
    clock = {"now": 0.0}
    polls = {"n": 0}

    def sleep(_seconds: float) -> None:
        polls["n"] += 1
        clock["now"] += 200.0
        if polls["n"] < 4:
            open_url.messages = working_messages("想" * polls["n"])  # 还在长，正文没落地
        else:
            open_url.messages = live_messages("答复正文")  # 这一圈才写完

    client = make_client(
        open_url,
        idle_timeout=240.0,
        now=lambda: clock["now"],
        sleep=sleep,
    )
    assert payload_from_outcome(client.ask("问题")) == {"status": "ok", "answer": "答复正文"}
    assert clock["now"] == 800.0  # 远超静默窗口：靠「一直在动」撑过来的，不是碰巧快


def test_the_hard_ceiling_stops_an_endless_loop_even_while_it_keeps_working() -> None:
    """一直有动静也不能无限跑：硬顶到了照样收场（防打转的 agent 循环占死那把锁）。"""
    open_url = FakeOpen(messages=live_messages(None))
    clock = {"now": 0.0}
    polls = {"n": 0}

    def sleep(_seconds: float) -> None:
        polls["n"] += 1
        clock["now"] += 100.0
        open_url.messages = working_messages("想" * polls["n"])  # 永远在动、永远不答完

    client = make_client(
        open_url,
        idle_timeout=240.0,  # 每圈才走 100s，静默窗口永远不会先到
        max_timeout=500.0,
        now=lambda: clock["now"],
        sleep=sleep,
    )
    assert payload_from_outcome(client.ask("问题")) == {
        "status": "error",
        "error": ERROR_TIMEOUT,
    }


def test_an_answer_that_never_fills_in_still_times_out() -> None:
    """答复开写了但正文一直空着（只有 reasoning），现场不再变 → 静默窗口一到就收场。"""
    open_url = FakeOpen(messages=working_messages("想"))  # 形状固定：不再往前走
    clock = {"now": 0.0}

    def jump_after_sleep(_seconds: float) -> None:
        clock["now"] += 200.0  # 每圈都跨过静默窗口

    client = make_client(
        open_url,
        idle_timeout=240.0,
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


# ---------------------------------------------------------------- 事件流（持续监控）


def test_event_stream_reads_are_switched_to_blocking() -> None:
    """握手的超时不能带进读里。

    真机上就是这里出的事：读超时抛一次，``http.client`` 的缓冲读就永久废了
    （``cannot read from timed out object``），于是第一圈安静之后的第二圈 ``drain``
    当场 ``dead``，问句秒回 ``opencode-not-running``。
    """
    open_url = FakeOpen(messages=live_messages("答复"))
    make_client(open_url).ask("问题")
    assert open_url.events.socket.timeout is None  # 连上之后读是无限等的


def test_beat_period_sits_between_the_two_drain_waits() -> None:
    """替身的心跳必须夹在 `drain` 的两个等待之间，不然两头都验不到。

    比安静窗慢，`drain` 才收得拢；比首个事件的等待快，`drain` 才等得到——
    等不到就没有字节，注入的假时钟一跳远就会被误判成心跳停摆。
    """
    assert DRAIN_QUIET_SECONDS < BEAT_PERIOD_SECONDS < DRAIN_FIRST_WAIT_SECONDS


def test_stream_death_is_reported_as_not_running() -> None:
    """opencode 一断流，等待当场收场——不陪它等到预算用完。

    老办法只能靠 `wait` 那个长挂的连接被对端收走才发觉；事件流是 TCP 一断立刻知道。
    """
    open_url = FakeOpen(messages=live_messages(None), events=FakeEvents(dies=True))
    outcome = make_client(open_url).ask("问题")

    assert outcome == {"kind": "not-running"}
    assert payload_from_outcome(outcome) == {"status": "error", "error": ERROR_NOT_RUNNING}
    assert open_url.calls[-1].url.endswith(f"/api/session/{CHILD}/interrupt")  # 掐掉半个轮次
    assert not any(c.method == "DELETE" for c in open_url.calls)  # 子会话留着复用
    assert not any(c.url.endswith("/wait") for c in open_url.calls)  # 走的是事件流这条路


def test_stalled_heartbeat_is_reported_as_not_running() -> None:
    """心跳停摆 30s ＝ 进程还在但卡住了：比等满预算早得多判出来。"""
    open_url = FakeOpen(messages=live_messages(None), events=FakeEvents(beats=False))
    clock = {"now": 0.0}

    def sleep(_seconds: float) -> None:
        clock["now"] = 40.0  # 一圈就越过停摆线（标称心跳 15s，漏两拍算数）

    client = make_client(open_url, now=lambda: clock["now"], sleep=sleep)
    assert payload_from_outcome(client.ask("问题")) == {
        "status": "error",
        "error": ERROR_NOT_RUNNING,
    }
    assert not any(c.url.endswith("/wait") for c in open_url.calls)


def test_progress_snapshot_reports_phase_and_written_while_waiting() -> None:
    """等待期间的现场能被 `/status` 读到：阶段往前走、字数往上加。

    这就是「等着的时候什么都不知道」的解药——中继知道的，页面侧也能知道。
    """
    open_url = FakeOpen(
        messages=live_messages(None),
        events=FakeEvents(
            lines=sse(
                child_event("session.execution.started"),
                child_event("session.text.started"),
                child_event("session.text.delta", delta="入口在"),
                child_event("session.text.delta", delta=" dsb。"),
            )
        ),
    )
    # sleep 里要读还造不出来的 client（构造时才收 sleep），先留个位置。
    client_slot: list[OpencodeClient] = []
    snapshots: list[Any] = []
    rounds = {"n": 0}

    def sleep(_seconds: float) -> None:
        rounds["n"] += 1
        snapshots.append(client_slot[0].status()["ask"])  # 这一圈的现场
        if rounds["n"] == 1:
            open_url.messages = live_messages("答复正文")

    client = make_client(open_url, idle_timeout=600.0, sleep=sleep)
    client_slot.append(client)

    assert payload_from_outcome(client.ask("问题")) == {"status": "ok", "answer": "答复正文"}
    assert snapshots[0] == {"phase": "writing", "written": 8, "remaining": 600.0}
    # 收摊之后不能留个幽灵问句
    assert client.status() == {"status": "ok", "ask": None}


def test_events_from_other_sessions_never_move_our_progress() -> None:
    """事件流上什么会话都有，只认自己 spawn 的那一个。"""
    open_url = FakeOpen(
        messages=live_messages(None),
        events=FakeEvents(
            lines=sse(
                {
                    "id": "evt_x",
                    "type": "session.execution.started",
                    "data": {"sessionID": "ses_别人家"},
                }
            )
        ),
    )
    # sleep 里要读还造不出来的 client（构造时才收 sleep），先留个位置。
    client_slot: list[OpencodeClient] = []
    snapshots: list[Any] = []

    def sleep(_seconds: float) -> None:
        snapshots.append(client_slot[0].status()["ask"])
        open_url.messages = live_messages("答复")

    client = make_client(open_url, idle_timeout=600.0, sleep=sleep)
    client_slot.append(client)

    assert client.ask("问题")["kind"] == "success"
    # 别人家开工了，我们的阶段还停在排队
    assert snapshots[0]["phase"] == "queued"
    assert snapshots[0]["written"] == 0


def test_status_is_idle_outside_an_ask() -> None:
    client = make_client(FakeOpen(messages=live_messages("答复")))
    assert client.status() == {"status": "ok", "ask": None}
    client.ask("问题")
    assert client.status() == {"status": "ok", "ask": None}


def test_probe_reports_opencode_liveness() -> None:
    """`/health` 里那个 `opencode` 字段：活的回 up，连不上回 down。"""
    assert make_client(FakeOpen()).probe() == "up"

    reads: list[int] = []

    def reader() -> dict[str, Any]:
        reads.append(1)
        return SERVICE

    failing = FakeOpen(active_error=urllib.error.URLError(ConnectionRefusedError("没起")))
    client = make_client(failing, service_reader=reader)
    assert client.probe() == "down"
    assert client.probe() == "down"
    assert len(reads) == 2  # 探活失败把口令缓存丢掉，每次都现读端口

    def boom() -> dict[str, Any]:
        raise ServiceUnavailable("服务没起")

    assert OpencodeClient(SESSION, service_reader=boom, urlopen=FakeOpen()).probe() == "down"
