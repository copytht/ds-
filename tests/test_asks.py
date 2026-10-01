"""按 id 复用的问句会话：一趟短轮询没等到就带同一个 id 再来；同一 id 只起一份活。

页面会话 id（/a/chat/s/<id> 里那段）这一层只透传，分表与子会话复用全在
dsb.client.OpencodeClient 那头（ADR-0005）。
"""

from __future__ import annotations

import threading
import time
from typing import Any

from dsb.asks import AskSessions


def test_without_an_id_it_blocks_like_before() -> None:
    sessions = AskSessions(lambda question, page: {"kind": "success", "question": question})
    assert sessions.ask("问") == {"kind": "success", "question": "问"}


def test_a_quick_run_comes_back_in_the_same_poll() -> None:
    sessions = AskSessions(
        lambda question, page: {"kind": "success", "question": question}, hold=5.0
    )
    assert sessions.ask("问", "q-1") == {"kind": "success", "question": "问"}


def test_a_slow_run_returns_pending_then_the_result() -> None:
    release = threading.Event()

    def slow(question: str, page: str | None) -> dict[str, Any]:
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

    def run(question: str, page: str | None) -> dict[str, Any]:
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
    def boom(question: str, page: str | None) -> dict[str, Any]:
        raise RuntimeError("炸了")

    sessions = AskSessions(boom, hold=5.0)
    assert sessions.ask("问", "q-1") == {"kind": "unexpected"}


def test_older_results_are_forgotten_once_the_keep_window_slides() -> None:
    runs: list[str] = []

    def run(question: str, page: str | None) -> dict[str, Any]:
        runs.append(question)
        return {"kind": "success", "question": question}

    sessions = AskSessions(run, hold=5.0, keep=1)
    sessions.ask("一", "a")
    sessions.ask("二", "b")
    sessions.ask("三", "a")
    assert runs == ["一", "二", "三"]


def test_page_session_id_is_passed_through_to_run() -> None:
    got: list[tuple[str, str | None]] = []
    release = threading.Event()

    def run(question: str, page: str | None) -> dict[str, Any]:
        got.append((question, page))
        release.wait(5)
        return {"kind": "success"}

    sessions = AskSessions(run, hold=0.05)
    sessions.ask("一问", "poll-1", "page-A")
    sessions.ask("二问", "poll-2", "page-B")
    sessions.ask("三问", "poll-3", None)
    release.set()
    time.sleep(0.1)
    assert ("一问", "page-A") in got
    assert ("二问", "page-B") in got
    assert ("三问", None) in got
