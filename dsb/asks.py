"""一次问句的「在途 / 已决」结果，按 id 复用——扩展的短轮询就挂在这上面。

**为什么不是一条长 fetch**：扩展原来对 ``/ask`` 挂一条长连接等到底。MV3 的 service worker
对一条在途 fetch 只保它约 5 分钟，更长的问句一过线，浏览器就把后台线程收走、连接断掉——
中继算完了也写不回去（真机日志里两次 ``BrokenPipeError``），页面永远等不到回灌，整条链子
就静默停在原地。改成「提交带 id、接着轮询」：每趟 fetch 都是短的（默认最多挂
:data:`DEFAULT_HOLD_SECONDS` 秒），后台线程一直有事做、service worker 不会被收，结果留在
中继手里，扩展这一趟没等到就带同一个 id 再问。

同一个 id 只起一份活：第二趟轮询撞上还在跑的，只等不说。结果留着，扩展掉线重连也能再取。
"""

from __future__ import annotations

import threading
import time
from collections import deque
from collections.abc import Callable, Mapping
from typing import Any

from dsb.log import log_event

#: 一趟轮询最多让请求挂多久——必须远小于浏览器对一条在途 fetch 的保活上限（约 5 分钟）。
DEFAULT_HOLD_SECONDS = 15.0
#: 已决结果留几个 id：扩展取到就没人再问，留几个兜「取到一半掉线」。
DEFAULT_KEEP_RESULTS = 32
#: 慢到这个数就留一条痕，免得「问了好久没回」事后无迹可查。
SLOW_ASK_MS = 300_000.0

RunFn = Callable[[str], Mapping[str, Any]]


class _Session:
    """一个 id 的一趟活：问题、结果、是否已出。"""

    def __init__(self, question: str) -> None:
        self.question = question
        self.outcome: Mapping[str, Any] | None = None
        self.done = threading.Event()


class AskSessions:
    """``(问题, id)`` → outcome：带 id 就短轮询复用，不带 id 就阻塞到底（老行为）。"""

    def __init__(
        self,
        run: RunFn,
        *,
        hold: float = DEFAULT_HOLD_SECONDS,
        keep: int = DEFAULT_KEEP_RESULTS,
    ) -> None:
        self._run = run
        self._hold = hold
        self._keep = keep
        self._lock = threading.Lock()
        self._sessions: dict[str, _Session] = {}
        self._order: deque[str] = deque()

    def ask(self, question: str, session_id: str | None = None) -> Mapping[str, Any]:
        """问一句：**不带 id** 阻塞到底（curl / 测试那条老路）；**带 id** 就最多挂 ``hold`` 秒，
        没出结果就回 ``{"kind": "pending", "id": ...}``，扩展拿同一个 id 再来。"""
        if not session_id:
            return self._run(question)
        session = self._get_or_start(question, session_id)
        session.done.wait(self._hold)
        if session.outcome is not None:
            return session.outcome
        return {"kind": "pending", "id": session_id}

    def _get_or_start(self, question: str, session_id: str) -> _Session:
        with self._lock:
            existing = self._sessions.get(session_id)
            if existing is not None:
                return existing
            session = _Session(question)
            self._sessions[session_id] = session
            self._order.append(session_id)
            while len(self._order) > self._keep:
                self._sessions.pop(self._order.popleft(), None)
            threading.Thread(
                target=self._work, args=(session,), name="dsb-ask", daemon=True
            ).start()
            return session

    def _work(self, session: _Session) -> None:
        """跑这一趟并留痕；任何岔子都折成可识别分支，别把线程炸没了。"""
        started = time.monotonic()
        try:
            session.outcome = self._run(session.question)
        except Exception:
            session.outcome = {"kind": "unexpected"}
        session.done.set()
        took_ms = (time.monotonic() - started) * 1000
        if took_ms >= SLOW_ASK_MS:
            # 「问了好久没回」得留一笔：断链时人只看得到这一行。
            log_event("ask-slow", took_ms=took_ms)
