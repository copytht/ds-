"""宿主 stdio 客户端与子会话问答的 outcome 折算。"""

from __future__ import annotations

import json
import sys
import threading
import time
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from dsb.client import (
    DEFAULT_IDLE_TIMEOUT,
    PHASE_RUNNING,
    HostProcess,
    ServiceUnavailable,
    SubagentClient,
    answer_prompt,
)
from dsb.opencode import ERROR_UNEXPECTED, error_payload, ok_payload, payload_from_outcome

TMP = Path("/tmp")


class FakeHost:
    """假宿主：按 op 回一条排好的回应，并把每次调用记下来。"""

    def __init__(self, replies: Mapping[tuple[str, str], Mapping[str, Any]] | None = None) -> None:
        self.replies = dict(replies or {})
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.closed = False
        self._gate: threading.Event | None = None

    def arm(self) -> threading.Event:
        """让下一次 ask 卡住不回，直到返回的事件被 set（用来测「在飞」的现场与串行）。"""
        self._gate = threading.Event()
        return self._gate

    def call(self, op: str, /, **fields: Any) -> Mapping[str, Any]:
        self.calls.append((op, fields))
        gate = self._gate
        if op == "ask" and gate is not None:
            self._gate = None
            gate.wait(2.0)
        if op != "ask":
            return {"ok": True, "op": op, **fields}
        reply = self.replies.get((op, fields["page"]))
        if reply is None:
            raise ServiceUnavailable("no reply")
        return reply

    def alive(self) -> bool:
        return not self.closed

    def close(self) -> None:
        self.closed = True


def ok(answer: str = "答复正文") -> Mapping[str, Any]:
    return {"ok": True, "stopReason": "completed", "answer": answer, "childId": "c1"}


def make_client(host: FakeHost | None = None, session_id: str = "ses_page") -> SubagentClient:
    return SubagentClient(session_id, host=host or FakeHost())


def echo_command(reply_expr: str) -> list[str]:
    """一个把每行请求换成固定回应的进程（真起一个，测认领与读口那条线）。

    回应必须带上请求的 ``id``——宿主那边就是靠它把回应认领回去的。
    """
    script = (
        "import sys, json\n"
        "for line in sys.stdin:\n"
        "    reply = dict(" + reply_expr + ")\n"
        "    reply['id'] = json.loads(line)['id']\n"
        "    sys.stdout.write(json.dumps(reply, ensure_ascii=False) + chr(10))\n"
        "    sys.stdout.flush()\n"
    )
    return [sys.executable, "-c", script]


def host_process(reply_expr: str) -> HostProcess:
    return HostProcess(echo_command(reply_expr), cwd=TMP)


# ---- 措辞 ----


def test_first_ask_carries_the_new_child_frame() -> None:
    assert answer_prompt("跑测试").startswith("你是一次全新委派里的子 agent")
    assert answer_prompt("跑测试").endswith("跑测试")


def test_followup_swaps_the_frame_but_keeps_the_discipline() -> None:
    assert answer_prompt("跑测试", followup=True).startswith("同一次委派里的后续问题")
    # 换框不等于松纪律：两版都要点名「只回答问题本身」。
    assert "只回答问题本身" in answer_prompt("x")
    assert "只回答问题本身" in answer_prompt("x", followup=True)


# ---- 折算 ----


def test_missing_session_is_not_a_question_at_all() -> None:
    assert make_client(session_id=None).send("跑测试") == {"kind": "unexpected"}


def test_dead_host_reports_not_running() -> None:
    assert make_client(FakeHost()).send("跑测试") == {"kind": "not-running"}


def test_completed_turn_surfaces_the_answer_text() -> None:
    host = FakeHost({("ask", "default"): ok("三行答复")})
    assert make_client(host).send("跑测试") == {"kind": "success", "body": "三行答复"}
    assert payload_from_outcome({"kind": "success", "body": "三行答复"}) == {
        "status": "ok",
        "answer": "三行答复",
    }


def test_blank_answer_is_not_success() -> None:
    host = FakeHost({("ask", "default"): ok("   ")})
    assert make_client(host).send("跑测试") == {"kind": "unexpected"}


def test_aborted_turn_is_a_timeout_and_gets_interrupted() -> None:
    host = FakeHost({("ask", "default"): {"ok": True, "stopReason": "aborted", "answer": ""}})
    assert make_client(host).send("跑测试") == {"kind": "timeout"}
    assert ("interrupt", {"page": "default"}) in host.calls


def test_error_turn_is_unexpected_and_still_gets_interrupted() -> None:
    host = FakeHost({("ask", "default"): {"ok": True, "stopReason": "error", "answer": ""}})
    assert make_client(host).send("跑测试") == {"kind": "unexpected"}
    assert ("interrupt", {"page": "default"}) in host.calls


# ---- 复用与分表 ----


def test_second_ask_reuses_the_child_and_switches_to_the_followup_frame() -> None:
    host = FakeHost({("ask", "default"): ok()})
    one = make_client(host)
    one.send("第一问")
    one.send("第二问")
    assert host.calls[0][1]["question"].startswith("你是一次全新委派里的子 agent")
    assert host.calls[1][1]["question"].startswith("同一次委派里的后续问题")


def test_a_call_without_a_page_session_shares_one_default_child() -> None:
    """认不出页面会话的调用（curl / 老调用）落 default 那一份，且 page 非空。"""
    host = FakeHost({("ask", "default"): ok()})
    one = make_client(host)
    one.send("第一问")
    one.send("第二问")
    assert [fields["page"] for op, fields in host.calls if op == "ask"] == ["default"] * 2
    assert host.calls[1][1]["question"].startswith("同一次委派里的后续问题")


def test_pages_do_not_share_a_frame() -> None:
    host = FakeHost({("ask", "a"): ok(), ("ask", "b"): ok()})
    one = make_client(host)
    one.send("第一问", page_session_id="a")
    one.send("第一问", page_session_id="b")  # b 是它的首问，不能跟着 a 变成续问
    assert host.calls[1][1]["page"] == "b"
    assert host.calls[1][1]["question"].startswith("你是一次全新委派里的子 agent")


def test_same_page_serializes_but_other_pages_do_not_wait() -> None:
    """一条会话一把锁：a 还在飞时 b 照样走得通，a 自己的下一问才排队。"""
    host = FakeHost({("ask", "a"): ok(), ("ask", "b"): ok()})
    one = make_client(host)
    gate = host.arm()
    blocked = threading.Thread(
        target=one.send, args=("慢问",), kwargs={"page_session_id": "a"}, daemon=True
    )
    blocked.start()
    time.sleep(0.1)
    assert blocked.is_alive()
    assert one.send("别的页面", page_session_id="b") == {"kind": "success", "body": "答复正文"}
    assert blocked.is_alive()  # b 走完了，a 还在飞
    gate.set()
    blocked.join(2.0)
    assert not blocked.is_alive()


# ---- 现场与生命周期 ----


def test_status_is_running_in_flight_and_none_when_idle() -> None:
    host = FakeHost({("ask", "a"): ok()})
    one = make_client(host)
    assert one.status() == {"status": "ok", "send": None}
    gate = host.arm()
    worker = threading.Thread(
        target=one.send, args=("慢问",), kwargs={"page_session_id": "a"}, daemon=True
    )
    worker.start()
    snapshot = None
    for _ in range(100):
        snapshot = one.progress
        if snapshot is not None:
            break
        time.sleep(0.02)
    assert snapshot == {"phase": PHASE_RUNNING, "question": "慢问"}
    gate.set()
    worker.join(2.0)
    assert one.status() == {"status": "ok", "send": None}


def test_probe_and_warm_up_both_follow_the_ping() -> None:
    assert make_client(FakeHost()).probe() == "up"
    assert make_client(FakeHost()).warm_up() is True
    broken = FakeHost()

    def refuse(op: str, /, **_fields: Any) -> Mapping[str, Any]:
        raise ServiceUnavailable("no host")

    broken.call = refuse  # type: ignore[method-assign]
    dead = make_client(broken)
    assert dead.probe() == "down"
    assert dead.warm_up() is False


def test_dispose_only_closes_a_host_we_started() -> None:
    borrowed = FakeHost()
    SubagentClient("ses_a", host=borrowed).dispose()
    assert borrowed.closed is False  # 借来的不关
    owned = SubagentClient("ses_a", command=["cat"], cwd=TMP)
    assert owned._host.alive() is True  # type: ignore[union-attr]
    owned.dispose()
    assert owned._host.alive() is False  # type: ignore[union-attr]


def test_idle_timeout_is_the_knob_dsh_cannot_take_away() -> None:
    # dsh 侧 continuable 阻塞到本轮终态，没有静默可看——上限只能源自带。
    assert DEFAULT_IDLE_TIMEOUT > 0


# ---- 宿主进程（真起一个回声进程）----


def test_host_process_routes_replies_back_by_id() -> None:
    host = host_process("{'ok': True, 'echo': 'hi'}")
    try:
        assert host.alive() is True
        reply = dict(host.call("ping"))
        assert reply.pop("ok") is True and reply.pop("echo") == "hi"
        assert reply.pop("id")  # 回应把请求的 id 带回来了，认领全靠它
        assert reply == {}  # 没有第三件不该有的东西
        assert host._pending == {}  # 认领完不留幽灵在途
    finally:
        host.close()
    assert host.alive() is False


def test_host_process_turns_a_failure_reply_into_service_unavailable() -> None:
    host = host_process("{'ok': False, 'error': '宿主没给好脸'}")
    try:
        try:
            host.call("ask")
        except ServiceUnavailable as error:
            assert "宿主没给好脸" in str(error)
        else:  # pragma: no cover - 只有没抛才走到
            raise AssertionError("失败回应必须折成 ServiceUnavailable")
    finally:
        host.close()


def test_host_process_wakes_callers_when_it_dies_mid_flight() -> None:
    host = HostProcess(
        [
            sys.executable,
            "-c",
            "import sys, time\n"
            "for line in sys.stdin:\n"
            "    time.sleep(10)\n",  # 只接单不回话，等读口那边断线
        ],
        cwd=TMP,
    )
    results: list[Exception] = []

    def call() -> None:
        try:
            host.call("ask")
        except ServiceUnavailable as error:
            results.append(error)

    worker = threading.Thread(target=call, daemon=True)
    worker.start()
    time.sleep(0.3)
    host.close()  # 让进程死掉：读口退场，把还挂着的人全叫醒
    worker.join(3.0)
    assert not worker.is_alive()
    assert results and "宿主退出了" in str(results[0])


# ---- 载荷 ----


def test_payloads_are_the_documented_shapes() -> None:
    assert payload_from_outcome({"kind": "not-running"}) == error_payload("opencode-not-running")
    assert payload_from_outcome({"kind": "timeout"}) == error_payload("opencode-timeout")
    assert payload_from_outcome("不是 dict") == error_payload(ERROR_UNEXPECTED)
    assert payload_from_outcome({"kind": "success", "body": "  "}) == error_payload(
        ERROR_UNEXPECTED
    )
    assert ok_payload("答")["answer"] == "答"
    assert json.loads(json.dumps(ok_payload("答")))["status"] == "ok"
