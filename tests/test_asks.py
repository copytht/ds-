"""按 id 复用的问句会话：一趟短轮询没等到就带同一个 id 再来；同一 id 只起一份活。

长 fetch 会被浏览器连同 service worker 一起收走（答复就此丢掉），所以 ``/ask`` 拆成短轮询。
"""

from __future__ import annotations

import threading
import time
from typing import Any

from dsb.asks import AskSessions


def test_without_an_id_it_blocks_like_before() -> None:
    """curl / 测试那条老路：不带 id，一次问到底。"""
    sessions = AskSessions(lambda question: {"kind": "success", "question": question})
    assert sessions.ask("问") == {"kind": "success", "question": "问"}


def test_a_quick_run_comes_back_in_the_same_poll() -> None:
    sessions = AskSessions(lambda question: {"kind": "success", "question": question}, hold=5.0)
    assert sessions.ask("问", "q-1") == {"kind": "success", "question": "问"}


def test_a_slow_run_returns_pending_then_the_result() -> None:
    """没出结果就回 pending（带 id），接着问同一 id 一定拿得到——结果留着，不重跑。"""
    release = threading.Event()

    def slow(question: str) -> dict[str, Any]:
        release.wait(5)
        return {"kind": "success", "question": question}

    sessions = AskSessions(slow, hold=0.05)
    assert sessions.ask("问", "q-1") == {"kind": "pending", "id": "q-1"}
    release.set()
    outcome: dict[str, Any] = {"kind": "pending"}
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        outcome = sessions.ask("问", "q-1")
        if outcome.get("kind") != "pending":
            break
        time.sleep(0.01)
    assert outcome == {"kind": "success", "question": "问"}


def test_the_same_id_never_starts_a_second_run() -> None:
    runs: list[str] = []
    release = threading.Event()

    def run(question: str) -> dict[str, Any]:
        runs.append(question)
        release.wait(5)
        return {"kind": "success"}

    sessions = AskSessions(run, hold=0.05)
    sessions.ask("问", "q-1")
    sessions.ask("问", "q-1")
    sessions.ask("问", "q-1")
    release.set()
    time.sleep(0.1)
    assert runs == ["问"]


def test_a_crashing_run_is_folded_into_an_unexpected_branch() -> None:
    def boom(question: str) -> dict[str, Any]:
        raise RuntimeError("炸了")

    sessions = AskSessions(boom, hold=5.0)
    assert sessions.ask("问", "q-1") == {"kind": "unexpected"}


def test_older_results_are_forgotten_once_the_keep_window_slides() -> None:
    runs: list[str] = []

    def run(question: str) -> dict[str, Any]:
        runs.append(question)
        return {"kind": "success", "question": question}

    sessions = AskSessions(run, hold=5.0, keep=1)
    sessions.ask("一", "a")
    sessions.ask("二", "b")
    sessions.ask("三", "a")  # a 早被挤出去，重新起一份活
    assert runs == ["一", "二", "三"]
