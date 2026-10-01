"""动作服务（ADR-0007）：token、SSE 动作流、按 target 的阻塞串行队列、失败码册子。

假扩展订阅者自己连 ``GET /actions`` 读 SSE、按约定把结果 ``POST /action/result`` 回传——
全程不碰真扩展，也不碰真 opencode（ask 一律 stub）。
"""

from __future__ import annotations

import contextlib
import json
import socket
import threading
import time
import urllib.error
import urllib.request
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import pytest

from dsb.actions import (
    ACTION_PATH,
    ACTION_RESULT_PATH,
    ACTIONS_PATH,
    KNOWN_ACTIONS,
    READ_ACTIONS,
    WRITE_ACTIONS,
    ActionServer,
    ensure_token,
    resolve_enabled,
)
from dsb.config import ACTION_TOKEN_PATH
from dsb.server import make_server, route

HOST = "127.0.0.1"
REPO_ROOT = Path(__file__).resolve().parents[1]
ACTION_FIXTURE = REPO_ROOT / "protocol" / "fixtures" / "action.json"
REQUEST = {"action": "tabs.list", "params": {}, "target": None}


def stub_ask(_question: str) -> dict[str, Any]:
    """替身 ask：动作测试不打 /ask，给个能过 payload 映射的形状即可。"""
    return {"kind": "success", "body": []}


def post_json(
    url: str, payload: dict[str, Any], headers: dict[str, str] | None = None, timeout: float = 10
) -> tuple[int, Any]:
    request = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), method="POST")
    request.add_header("Content-Type", "application/json")
    for name, value in (headers or {}).items():
        request.add_header(name, value)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read())


class FakeSubscriber:
    """假扩展：连 ``/actions`` 收动作，逐条把 ``on_action`` 的返回值回传。

    ``on_action`` 返回 ``None`` 表示「收到了但不回传」（测 timeout 用）。
    每个动作一个线程——真实扩展本来就按标签页并行，别让假扩展替队列把顺序做了。
    """

    def __init__(self, base: str, on_action: Callable[[dict[str, Any]], Any]) -> None:
        host, _, port = base.removeprefix("http://").partition(":")
        self.base = base
        self.on_action = on_action
        self.subscribed = threading.Event()
        self._sock = socket.create_connection((host, int(port)), timeout=10)
        self._sock.sendall(
            (
                f"GET {ACTIONS_PATH} HTTP/1.1\r\n"
                f"Host: {host}:{port}\r\n"
                "Accept: text/event-stream\r\n\r\n"
            ).encode()
        )
        self._file = self._sock.makefile("r", encoding="utf-8", newline="\n")
        self._read_headers()
        self._workers: list[threading.Thread] = []
        self._pump = threading.Thread(target=self._read_stream, daemon=True)
        self._pump.start()

    def _read_headers(self) -> None:
        status = self._file.readline().strip()
        assert " 200" in status, status
        headers: dict[str, str] = {}
        for line in self._file:
            if line in ("\r\n", "\n", ""):
                break
            name, _, value = line.partition(":")
            headers[name.strip().lower()] = value.strip()
        assert headers.get("content-type") == "text/event-stream", headers
        # ADR-0007：读端点不下发 CORS 头，网页的跨源读才撞得死。
        assert "access-control-allow-origin" not in headers, headers

    def _read_stream(self) -> None:
        try:
            for line in self._file:
                line = line.rstrip("\n")
                if not line.startswith("data:"):
                    continue
                frame = json.loads(line[len("data:") :])
                if frame.get("type") == "subscribed":
                    self.subscribed.set()
                    continue
                if frame.get("type") == "action":
                    worker = threading.Thread(target=self._execute, args=(frame,), daemon=True)
                    self._workers.append(worker)
                    worker.start()
        except OSError:
            pass  # socket 被收走：读流的这条线就此收摊

    def _execute(self, frame: dict[str, Any]) -> None:
        outcome = self.on_action(frame)
        if outcome is None:
            return  # 拿到了故意不回传
        # 带 "ok" 键的 dict = 假扩展直接回一个 ActionOutcome：原样透传 ok / result / error，
        # 只补帧的 id（这是「扩展回失败码 → submit 原样拿到」那条环的入口）。
        # 其余一律走老路：当成 result 塞进成功回传，既有用例（{"tabs": …} / {} / {"echo": …}）
        # 零影响。
        if isinstance(outcome, dict) and "ok" in outcome:
            post_json(
                f"{self.base}{ACTION_RESULT_PATH}",
                {"id": frame["id"], **outcome},
            )
            return
        post_json(
            f"{self.base}{ACTION_RESULT_PATH}",
            {"id": frame["id"], "ok": True, "result": outcome},
        )

    def wait_subscribed(self, timeout: float = 5) -> None:
        assert self.subscribed.wait(timeout), "动作流没送订阅成功帧"

    def join(self, timeout: float = 5) -> None:
        for worker in self._workers:
            worker.join(timeout)

    def close(self) -> None:
        # shutdown 先把连接收掉：socket.makefile 挂着 io 引用时 close() 不落 fd，
        # 中继那边就一直看到「还活着」，断线用例会白等一轮超时。
        with contextlib.suppress(OSError):
            self._sock.shutdown(socket.SHUT_RDWR)
        self._sock.close()

    def __enter__(self) -> FakeSubscriber:
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()


@pytest.fixture()
def actions(tmp_path: Path) -> Iterator[tuple[str, ActionServer, str]]:
    """随机端口起中继 + 动作服务；token 现生成在 tmp 里，收摊时一起关。"""
    token = ensure_token(tmp_path / "token")
    service = ActionServer(token, timeout=1.0)
    server = make_server(stub_ask, host=HOST, port=0, actions=service)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://{HOST}:{server.server_address[1]}", service, token
    server.shutdown()
    server.server_close()
    thread.join(timeout=5)


def submit(base: str, payload: dict[str, Any], token: str) -> tuple[int, Any]:
    return post_json(f"{base}{ACTION_PATH}", payload, headers={"Authorization": f"Bearer {token}"})


def fixture_case(name: str) -> dict[str, Any]:
    cases = json.loads(ACTION_FIXTURE.read_text(encoding="utf-8"))["cases"]
    for case in cases:
        if case["name"] == name:
            return case
    raise AssertionError(f"fixture 里没有「{name}」这个 case")


# ---- token ----


def test_token_is_generated_private_and_reused(tmp_path: Path) -> None:
    path = tmp_path / "token"
    token = ensure_token(path)

    assert len(token) >= 32, "token 要有足够熵"
    assert path.stat().st_mode & 0o777 == 0o600, "token 只能本用户可读"
    assert ensure_token(path) == token, "已存在必须复用，不能重写"
    assert path.read_text(encoding="utf-8").strip() == token
    assert path.stat().st_mode & 0o777 == 0o600


def test_default_token_path_is_out_of_version_control() -> None:
    """调用方从固定路径读，路径本身不进版本库。"""
    assert ACTION_TOKEN_PATH.name == ".dsb-token"
    ignored = (REPO_ROOT / ".gitignore").read_text(encoding="utf-8").splitlines()
    assert ACTION_TOKEN_PATH.name in ignored, ".gitignore 没盖住 token 落点"


# ---- 鉴权 ----


@pytest.mark.parametrize("authorization", [None, "Bearer nope", "Bearer"])
def test_post_action_without_a_valid_token_is_unauthorized(
    actions: tuple[str, ActionServer, str], authorization: str | None
) -> None:
    base, _service, token = actions
    headers = {} if authorization is None else {"Authorization": authorization}
    status, payload = post_json(f"{base}{ACTION_PATH}", REQUEST, headers=headers)

    assert status == 401
    assert payload == {"ok": False, "action": "tabs.list", "error": "unauthorized"}
    assert token  # token 确实在手，只是没递给它


# ---- 没订阅者 / 断线 ----


def test_submit_without_a_subscriber_fails_loudly(
    actions: tuple[str, ActionServer, str],
) -> None:
    base, _service, token = actions
    assert submit(base, REQUEST, token) == (
        200,
        {"ok": False, "action": "tabs.list", "error": "no-subscriber"},
    )


def test_a_subscriber_that_disconnects_fails_loudly(
    actions: tuple[str, ActionServer, str],
) -> None:
    """断了就明确报错，不静默排队——排了也永远等不到回传。"""
    base, _service, token = actions
    with FakeSubscriber(base, lambda _frame: {"echo": "x"}) as subscriber:
        subscriber.wait_subscribed()

    assert submit(base, REQUEST, token) == (
        200,
        {"ok": False, "action": "tabs.list", "error": "no-subscriber"},
    )


# ---- 阻塞式往返 ----


def test_submit_blocks_and_returns_the_result_of_this_call(
    actions: tuple[str, ActionServer, str],
) -> None:
    """原地拿到 result——不是拿 id 再去取（ADR-0007 弃的那条路）。"""
    base, _service, token = actions
    case = fixture_case("tabs.list 成功")
    executed: list[dict[str, Any]] = []

    def on_action(frame: dict[str, Any]) -> Any:
        executed.append(frame)
        return case["response"]["result"]

    with FakeSubscriber(base, on_action) as subscriber:
        subscriber.wait_subscribed()
        status, payload = submit(base, case["request"], token)
        subscriber.join()

    assert status == 200
    assert payload == case["response"], "回的必须是 fixture 里那份成功样例"
    assert [frame["action"] for frame in executed] == ["tabs.list"]


def test_every_submit_pushes_an_action_frame(
    actions: tuple[str, ActionServer, str],
) -> None:
    """下发的帧带 type/id/action/params/target，扩展照着就能执行。"""
    base, _service, token = actions
    frames: list[dict[str, Any]] = []

    def on_action(frame: dict[str, Any]) -> Any:
        frames.append(frame)
        return {}

    with FakeSubscriber(base, on_action) as subscriber:
        subscriber.wait_subscribed()
        status, payload = submit(
            base, {"action": "page.state", "params": {"x": 1}, "target": "42"}, token
        )
        subscriber.join()

    assert (status, payload) == (200, {"ok": True, "action": "page.state", "result": {}})
    assert frames[0]["type"] == "action"
    assert frames[0]["action"] == "page.state"
    assert frames[0]["params"] == {"x": 1}
    assert frames[0]["target"] == "42"
    assert isinstance(frames[0]["id"], str) and frames[0]["id"]


# ---- 串行与并行 ----


def test_same_target_is_serial_and_other_targets_do_not_block(
    actions: tuple[str, ActionServer, str],
) -> None:
    base, _service, token = actions
    events: list[tuple[str, str, float]] = []
    guard = threading.Lock()

    def on_action(frame: dict[str, Any]) -> Any:
        tag = str(frame["params"].get("tag", ""))
        with guard:
            events.append((tag, "start", time.monotonic()))
        if tag == "A":
            time.sleep(0.4)  # 同标签页的后一个动作只可能在它之后才被下发
        with guard:
            events.append((tag, "end", time.monotonic()))
        return {"echo": tag}

    results: list[tuple[int, Any]] = []
    errors: list[str] = []

    def fire(tag: str, target: str | None) -> None:
        try:
            results.append(
                submit(
                    base,
                    {"action": "tabs.list", "params": {"tag": tag}, "target": target},
                    token,
                )
            )
        except BaseException as exc:  # 线里抛的不能吞：wait_for 只看得到 events
            errors.append(repr(exc))

    with FakeSubscriber(base, on_action) as subscriber:
        subscriber.wait_subscribed()
        threads = [threading.Thread(target=fire, args=("A", "42"))]
        threads[0].start()
        wait_for(
            lambda: (
                any(tag == "A" and phase == "start" for tag, phase, _ in events)
                or errors
                or results
            ),
            hint=lambda: f"events={events} results={results} errors={errors}",
        )

        slow = threading.Thread(target=fire, args=("B", "42"))  # 同 target：必须排队
        other = threading.Thread(target=fire, args=("C", "7"))  # 另一个 target：不该等
        slow.start()
        other.start()
        threads += [slow, other]
        for thread in threads:
            thread.join(timeout=10)
        subscriber.join()

    assert not errors, errors
    at = {tag: {} for tag in ("A", "B", "C")}
    for tag, phase, moment in events:
        at[tag][phase] = moment

    assert at["A"]["end"] < at["B"]["start"], f"同 target 没串行：{at}"
    assert at["C"]["start"] < at["A"]["end"], f"不同 target 被拖住了：{at}"
    assert all(status == 200 for status, _payload in results)
    assert {payload["result"]["echo"] for _status, payload in results} == {"A", "B", "C"}


def wait_for(
    predicate: Callable[[], bool], timeout: float = 5, hint: Callable[[], str] | None = None
) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.01)
    raise AssertionError(f"等不到预期的现场：{hint() if hint else ''}")


# ---- 失败码 ----


def test_disabled_toggle_comes_back_as_disabled(
    actions: tuple[str, ActionServer, str],
) -> None:
    base, service, token = actions
    with FakeSubscriber(base, lambda _frame: {"echo": "x"}) as subscriber:
        subscriber.wait_subscribed()
        service.enabled = False
        assert submit(base, REQUEST, token) == (
            200,
            {"ok": False, "action": "tabs.list", "error": "disabled"},
        )
    service.enabled = True  # 别把同服务里的别的用例带下水


def test_unknown_action_comes_back_as_unknown_action(
    actions: tuple[str, ActionServer, str],
) -> None:
    base, _service, token = actions
    with FakeSubscriber(base, lambda _frame: {"echo": "x"}) as subscriber:
        subscriber.wait_subscribed()
        status, payload = submit(base, {"action": "page.nope", "params": {}, "target": None}, token)

    assert status == 200
    assert payload == {"ok": False, "action": "page.nope", "error": "unknown-action"}


def test_subscriber_replies_disabled_comes_back_disabled(
    actions: tuple[str, ActionServer, str],
) -> None:
    base, _service, token = actions
    with FakeSubscriber(base, lambda _frame: {"ok": False, "error": "disabled"}) as subscriber:
        subscriber.wait_subscribed()
        status, payload = submit(base, REQUEST, token)

    assert status == 200
    assert payload == {"ok": False, "action": "tabs.list", "error": "disabled"}


def test_subscriber_replies_unknown_action_comes_back_unknown_action(
    actions: tuple[str, ActionServer, str],
) -> None:
    base, _service, token = actions

    def unknown(_frame: object) -> dict[str, object]:
        return {"ok": False, "error": "unknown-action"}

    with FakeSubscriber(base, unknown) as subscriber:
        subscriber.wait_subscribed()
        status, payload = submit(base, REQUEST, token)

    assert status == 200
    assert payload == {"ok": False, "action": "tabs.list", "error": "unknown-action"}


def test_subscriber_replies_tab_gone_comes_back_tab_gone(
    actions: tuple[str, ActionServer, str],
) -> None:
    base, _service, token = actions
    with FakeSubscriber(base, lambda _frame: {"ok": False, "error": "tab-gone"}) as subscriber:
        subscriber.wait_subscribed()
        status, payload = submit(
            base,
            {"action": "tabs.list", "params": {}, "target": "42"},
            token,
        )

    assert status == 200
    assert payload == {"ok": False, "action": "tabs.list", "error": "tab-gone"}


def test_no_result_within_the_budget_times_out(
    actions: tuple[str, ActionServer, str],
) -> None:
    base, service, token = actions
    started = time.monotonic()
    with FakeSubscriber(base, lambda _frame: None) as subscriber:  # 收了不回传
        subscriber.wait_subscribed()
        status, payload = submit(base, REQUEST, token)
    waited = time.monotonic() - started

    assert (status, payload) == (
        200,
        {"ok": False, "action": "tabs.list", "error": "timeout"},
    )
    assert waited >= service.timeout, "没等到回传就该真等满预算再判死"


def test_malformed_body_is_a_protocol_error_not_an_action_error(
    actions: tuple[str, ActionServer, str],
) -> None:
    base, _service, token = actions
    status, payload = post_json(
        f"{base}{ACTION_PATH}",
        {"action": 42},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert status == 400
    assert payload == {"ok": False, "action": "", "error": "unexpected-response"}


# ---- 名册 ----


def test_the_book_only_admits_actions_it_can_relay() -> None:
    """名册 = ADR-0007 的只读动作 + **已落地**的写动作；没实现的仍判不出名字。"""
    assert {
        "tabs.list",
        "page.state",
        "composer.read",
        "messages.list",
        "messages.last",
    } == READ_ACTIONS
    assert READ_ACTIONS | {"composer.type", "composer.clear", "send.click", "send.enter"} == (
        KNOWN_ACTIONS
    )
    assert "stop.click" not in KNOWN_ACTIONS  # 还是占位，实现后再并进来
    assert set(WRITE_ACTIONS) == {
        "stop.click",
        "chat.new",
        "wait.reply",
        "wait.fence",
        "toggle.get",
        "toggle.set",
    }


def test_failure_codes_match_the_fixture_book() -> None:
    """失败码册子必须与 protocol/fixtures/action.json 同一份（一字不差）。"""
    book = json.loads(ACTION_FIXTURE.read_text(encoding="utf-8"))["errorCodes"]
    assert {entry["code"] for entry in book} == {
        "unauthorized",
        "no-subscriber",
        "disabled",
        "unknown-action",
        "timeout",
        "tab-gone",
    }


# ---- 开关从配置读 ----


def test_resolve_enabled_reads_the_process_then_the_env_file(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("DSB_ACTIONS_ENABLED", "0")
    assert resolve_enabled("") is False
    monkeypatch.delenv("DSB_ACTIONS_ENABLED")
    assert resolve_enabled("DSB_ACTIONS_ENABLED=false") is False
    assert resolve_enabled("DSB_ACTIONS_ENABLED=on") is True
    assert resolve_enabled("") is True


# ---- 纯接缝 ----


def test_route_hands_action_requests_to_its_own_seam() -> None:
    def action(body: bytes, authorization: str | None) -> tuple[int, dict[str, Any]]:
        assert json.loads(body) == REQUEST
        assert authorization == "Bearer 手里的"
        return 401, {"ok": False, "action": "tabs.list", "error": "unauthorized"}

    assert route(
        "POST",
        "/action?x=1",
        json.dumps(REQUEST).encode(),
        stub_ask,
        action=action,
        authorization="Bearer 手里的",
    ) == (401, {"ok": False, "action": "tabs.list", "error": "unauthorized"})
    # 没接动作服务时按未知端点走，不假装自己能执行
    assert route("POST", "/action", json.dumps(REQUEST).encode(), stub_ask)[0] == 404
    assert route("POST", "/action/result", b"{}", stub_ask)[0] == 404
    # SSE 不走这条纯接缝：它得写流（由 RelayHandler 单独接）
    assert route("GET", ACTIONS_PATH, b"", stub_ask)[0] == 404


def test_result_endpoint_needs_no_token(actions: tuple[str, ActionServer, str]) -> None:
    """扩展给不到 token（ADR-0007 分头认），回传端点靠 id 认人。"""
    base, _service, _token = actions
    status, payload = post_json(f"{base}{ACTION_RESULT_PATH}", {"id": "没有的", "ok": True})
    assert (status, payload) == (200, {"status": "ok"})


def test_action_paths_are_the_three_from_the_adr() -> None:
    assert (ACTION_PATH, ACTIONS_PATH, ACTION_RESULT_PATH) == (
        "/action",
        "/actions",
        "/action/result",
    )
