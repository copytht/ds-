"""SSE 行的解析、判死属性，以及进度快照（纯逻辑，不碰真 opencode）。"""

from __future__ import annotations

import threading
import time

from dsb.client import PHASE_QUEUED, PHASE_WRITING, SendProgress
from dsb.events import (
    EVENT_HEARTBEAT,
    EVENT_QUEUE_CAP,
    STALE_AFTER_SECONDS,
    EventStream,
    delta_of,
    parse_line,
    session_id_of,
)

CHILD = "ses_child"


def test_parse_line_accepts_a_data_frame() -> None:
    assert parse_line('data: {"type": "session.created", "data": {"sessionID": "ses_1"}}') == {
        "type": "session.created",
        "data": {"sessionID": "ses_1"},
    }


def test_parse_line_keeps_heartbeat_and_drops_the_rest() -> None:
    assert parse_line(": heartbeat") == {"type": EVENT_HEARTBEAT}
    assert parse_line(": 别的注释") is None
    assert parse_line("") is None
    assert parse_line("event: message") is None  # 事件名走字段，不走事件行
    assert parse_line("data:") is None
    assert parse_line("data: 半截 json") is None  # 一行坏数据不该掀翻整轮等待
    assert parse_line("data: [1, 2]") is None  # 不是对象的不认


def test_session_id_and_delta_are_read_from_the_payload() -> None:
    event = {"type": "session.text.delta", "data": {"sessionID": "ses_1", "delta": "好"}}
    assert session_id_of(event) == "ses_1"
    assert delta_of(event) == "好"
    assert session_id_of({"type": "server.connected", "data": {}}) is None
    assert session_id_of({"type": "server.connected"}) is None
    assert session_id_of("不是对象") is None
    assert delta_of({"type": "x"}) == ""


class FakeResponse:
    """按预设交出行：交完要么安静（抛超时），要么收摊（回空）。"""

    def __init__(self, lines: list[str], *, dies: bool) -> None:
        self._lines = list(lines)
        self._dies = dies

    def readline(self) -> str:
        if self._lines:
            return self._lines.pop(0)
        if self._dies:
            return ""
        raise TimeoutError("安静")

    def close(self) -> None:
        pass


def test_drain_collects_every_line_and_quiet_is_not_death() -> None:
    clock = {"now": 0.0}
    stream = EventStream(
        FakeResponse(['data: {"type": "a"}\n', "\n", ": heartbeat\n"], dies=False),
        now=lambda: clock["now"],
    )
    stream.pump()  # 读在后台线程里跑，测试直接调
    assert [event["type"] for event in stream.drain()] == ["a", EVENT_HEARTBEAT]
    assert stream.dead is False  # 安静不等于死——opencode 有心跳，只是这一阵没事件
    clock["now"] = STALE_AFTER_SECONDS + 1
    assert stream.stale is True  # 心跳停摆才判


def test_eof_marks_the_stream_dead_immediately() -> None:
    stream = EventStream(FakeResponse([], dies=True), now=lambda: 0.0)
    stream.pump()
    assert stream.drain() == []
    assert stream.dead is True
    assert stream.stale is False  # 断流走 dead 这条，轮不到心跳


def test_close_never_lets_teardown_change_the_outcome() -> None:
    class Angry:
        def readline(self) -> str:
            raise TimeoutError("x")

        def close(self) -> None:
            raise OSError("关不掉")

    EventStream(Angry(), now=lambda: 0.0).close()  # 不抛就算过


def test_start_reads_on_its_own_thread_so_the_wait_loop_never_blocks() -> None:
    """主线程只管取：读堵在 socket 上的时候，等待循环还得照样查预算、上报现场。"""
    stream = EventStream(FakeResponse(['data: {"type": "a"}\n'], dies=False), now=lambda: 0.0)
    stream.start()
    stream.start()  # 重复 start 不该起第二条线程
    events: list[dict] = []
    for _ in range(200):  # 最多等 2s；行是现成的，真要这么久就是没读起来
        events = stream.drain()
        if events:
            break
        time.sleep(0.01)
    assert [event["type"] for event in events] == ["a"]
    assert stream.dead is False
    stream.close()


class BlockedResponse:
    """堵在读上不放行，直到 ``close()`` 来把它叫醒（模拟服务端一直不吐字）。"""

    def __init__(self) -> None:
        self.released = threading.Event()

    def readline(self) -> str:
        self.released.wait(2)
        return ""

    def close(self) -> None:
        self.released.set()


def test_close_wakes_the_reader_and_does_not_count_as_a_dead_stream() -> None:
    response = BlockedResponse()
    stream = EventStream(response, now=lambda: 0.0)
    stream.start()
    time.sleep(0.05)  # 让线程先堵到读上
    stream.close()
    time.sleep(0.05)  # 放行之后线程该自己退出
    assert stream.dead is False  # 是我们收的摊，不能反过来记成 opencode 断了


def test_pump_holds_at_most_the_queue_cap_when_nobody_is_draining() -> None:
    """主线程一时半刻取不走时，内存不能跟着流一起长。"""

    def line(i: int) -> str:
        return f'data: {{"type": "tick", "data": {{"i": {i}}}}}\n'

    lines = [line(i) for i in range(EVENT_QUEUE_CAP + 50)]
    stream = EventStream(FakeResponse(lines, dies=True), now=lambda: 0.0)
    stream.pump()
    assert stream.dead is True  # 读到底了照样判死，上限只是不攒那么多
    assert len(stream.drain()) == EVENT_QUEUE_CAP


def test_progress_is_idle_until_an_ask_begins() -> None:
    progress = SendProgress()
    assert progress.snapshot() is None  # 空档不留幽灵问句
    progress.begin()
    assert progress.snapshot() == {"phase": PHASE_QUEUED, "written": 0, "remaining": None}
    progress.tick(120.0)
    assert progress.snapshot()["remaining"] == 120.0
    progress.finish()
    assert progress.snapshot() is None


def test_progress_counts_writing_from_its_own_session_only() -> None:
    progress = SendProgress()
    progress.begin()
    progress.note(
        [
            {"type": "session.execution.started", "data": {"sessionID": "ses_别人家"}},
            {"type": "session.execution.started", "data": {"sessionID": CHILD}},
            {"type": "session.text.delta", "data": {"sessionID": CHILD, "delta": "两个字"}},
            {"type": "session.text.delta", "data": {"sessionID": "ses_别人家", "delta": "x" * 99}},
        ],
        CHILD,
    )
    snapshot = progress.snapshot()
    assert snapshot is not None
    assert snapshot["phase"] == PHASE_WRITING
    assert snapshot["written"] == 3  # 别人家那 99 个字不算我们的


def test_progress_falls_back_to_the_message_side_without_an_event_stream() -> None:
    """事件流缺席时，正文侧也能认出「开写了」，阶段照样往前走。"""
    progress = SendProgress()
    progress.begin()
    assert progress.snapshot()["phase"] == PHASE_QUEUED
    progress.writing()
    assert progress.snapshot()["phase"] == PHASE_WRITING
    progress.done()
    assert progress.snapshot()["phase"] == "done"
    progress.finish()
    assert progress.snapshot() is None
