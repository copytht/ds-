"""opencode 的事件流（``GET /api/event``）：等待期的实时信号源。

实测（v2.0.18）：连上先回一条 ``server.connected``，之后逐条 ``data: {json}`` 事件，
每 15s 一行 ``: heartbeat`` 注释；每个事件都带 ``data.sessionID``，所以只认自己 spawn
出来的那个子会话就够。两个判死的口子都在这条流上：

- **断流**（EOF / 连接错）＝ opencode 死了，TCP 一断当场就知道；
- **心跳停摆 30s** ＝ 进程还在但卡住了（标称 15s 一拍，漏两拍算数）。

等待循环靠它把「开工 / 在写 / 写完」说出来；正文仍以
``GET /api/session/{id}/message`` 为准——事件只当信号，不当内容。

**读为什么必须挪到自己的线程里**（真机上撞出来的，差点当成本地 bug）：
``http.client`` 的缓冲读一旦抛过一次读超时，那个 ``SocketIO`` 就永久废了——之后每次
读都立刻回 ``OSError: cannot read from timed out object``。老写法拿 0.2s 读超时当
「这一阵安静」，于是第一次安静就把这条流判了死：第一圈 ``drain`` 还正常，第二圈当场
``dead``，问句秒回 ``opencode-not-running``。所以现在是——

- 握手设超时（连不上就别占着），**连上之后读是无限等的**（``settimeout(None)``）；
- 读跑在一条后台线程里，只由它碰 socket；
- 主线程 :meth:`EventStream.drain` 在条件变量上等「这一阵安静」，等的是**时间**，
  不是 socket 上的读超时——毒不了；「安静」也不再等于死，判死仍走 ``dead`` / ``stale``。
"""

from __future__ import annotations

import contextlib
import json
import socket
import threading
import time
from collections import deque
from collections.abc import Callable, Mapping
from typing import Any

EVENT_PATH = "/api/event"

#: opencode 的心跳标称间隔（实测 15s 整，一秒不差）。
HEARTBEAT_SECONDS = 15.0
#: 漏两拍就当它卡死：进程活着但不再吐字，比「等满预算」早得多判出来。
STALE_AFTER_SECONDS = 2 * HEARTBEAT_SECONDS
#: 握手（连上 + 等响应头）的上限——**只管握手**，管不着后面的读。
OPEN_TIMEOUT_SECONDS = 5.0
#: 等头一个事件的上限：流安静时一趟最多耗这么久（心跳 15s 一拍，绰绰有余）。
DRAIN_FIRST_WAIT_SECONDS = 0.3
#: 已经到手的事件只要还在来就接着收，隔这么久没有新的就算这一口气到头。
DRAIN_QUIET_SECONDS = 0.05
#: 单次 :meth:`EventStream.drain` 的硬上限：流一直不停也得交差，
#: 否则永远轮不到预算检查与进度上报那一步。
DRAIN_MAX_SECONDS = 0.5
#: 攒着待取的事件上限：主线程一时半刻取不走时兜底，别让内存跟着流一起长。
EVENT_QUEUE_CAP = 10_000

EVENT_HEARTBEAT = "heartbeat"
EVENT_EXECUTION_STARTED = "session.execution.started"
EVENT_TEXT_STARTED = "session.text.started"
EVENT_TEXT_DELTA = "session.text.delta"
EVENT_EXECUTION_SUCCEEDED = "session.execution.succeeded"


def parse_line(line: str) -> dict[str, Any] | None:
    """一行 SSE → 事件 dict；心跳注释回 ``{"type": "heartbeat"}``，其余回 ``None``。"""
    if line.startswith(":"):
        return {"type": EVENT_HEARTBEAT} if "heartbeat" in line else None
    if not line.startswith("data:"):
        return None
    raw = line[len("data:") :].strip()
    if not raw:
        return None
    try:
        event = json.loads(raw)
    except json.JSONDecodeError:
        return None  # 半截 json 当没看见，别让一行坏数据掀翻整轮等待
    return event if isinstance(event, dict) else None


def session_id_of(event: Any) -> str | None:
    """事件 → 它属于哪个会话（认不出回 ``None``，自然被过滤掉）。"""
    if not isinstance(event, Mapping):
        return None
    data = event.get("data")
    if not isinstance(data, Mapping):
        return None
    session_id = data.get("sessionID")
    return session_id if isinstance(session_id, str) else None


def delta_of(event: Mapping[str, Any]) -> str:
    """``session.text.delta`` 的增量正文（认不出回空串）。"""
    data = event.get("data")
    if not isinstance(data, Mapping):
        return ""
    delta = data.get("delta")
    return delta if isinstance(delta, str) else ""


def socket_of(response: Any) -> Any | None:
    """这条连接的 socket（``http.client`` 的 ``fp.raw._sock``）；认不出回 ``None``。"""
    fp = getattr(response, "fp", None)
    raw = getattr(fp, "raw", None)
    sock = getattr(raw, "_sock", None)
    if sock is None or not hasattr(sock, "settimeout") or not hasattr(sock, "shutdown"):
        return None
    return sock


def make_reads_block(response: Any) -> bool:
    """把这条连接的读改成无限等；认不出 socket 或设不上就回 ``False``。

    握手的超时不能带进读里：只要超时抛过一次，``http.client`` 的缓冲读就废了
    （``cannot read from timed out object``），这条流再也读不出字节，只会被当场判死。
    """
    sock = socket_of(response)
    if sock is None:
        return False
    try:
        sock.settimeout(None)
    except OSError:
        return False
    return True


class EventStream:
    """一条 ``GET /api/event`` 连接：后台线程读，主线程 :meth:`drain` 收。

    挂不上或读不动都不抛给调用方——``dead`` 与 ``stale`` 两个属性就是判死的依据，
    由等待循环决定怎么收场。
    """

    def __init__(self, response: Any, now: Callable[[], float] = time.monotonic) -> None:
        self._response = response
        self._readline = response.readline
        self._now = now
        self._cond = threading.Condition()
        self._pending: deque[dict[str, Any]] = deque()
        self._last_byte = now()
        self._closed = False
        self._dead = False
        self._thread: threading.Thread | None = None

    # ---- 读的一侧（后台线程）----

    def start(self) -> None:
        """把读挂到自己的线程上：等待期的现场全靠它一边读一边攒，主线程等不起。"""
        if self._thread is not None:
            return
        thread = threading.Thread(target=self.pump, name="dsb-events", daemon=True)
        self._thread = thread
        thread.start()

    def pump(self) -> None:
        """把流读到底：字节到手就记时间、事件进队，读不出来才收摊。

        生产上这条跑在后台线程里（读是无限等的，所以它会一直堵到有字节或流断）；
        测试可以直接调它，用一个交完行就抛 ``TimeoutError`` 的替身来表示「这一阵安静」。
        """
        while not self._closed:
            try:
                raw = self._readline()
            except TimeoutError:
                return  # 安静：生产上读是无限等的，走不到这条；留给替身表示「没新事件」
            except Exception:
                self._die()  # 连接被对端收走 = opencode 没了
                return
            if not raw:
                self._die()  # EOF = 对面收摊
                return
            text = raw.decode("utf-8", "replace") if isinstance(raw, bytes) else raw
            events = [
                event for line in text.splitlines() if (event := parse_line(line)) is not None
            ]
            with self._cond:
                self._last_byte = self._now()
                self._pending.extend(events)
                while len(self._pending) > EVENT_QUEUE_CAP:
                    self._pending.popleft()  # 兜底：读不过来时丢最旧的，进度差几个字不致命
                self._cond.notify_all()

    def _die(self) -> None:
        """标断流——但只有不是我们自己收的摊时才算；顺手叫醒正等着的 drain。"""
        with self._cond:
            if not self._closed:
                self._dead = True
            self._cond.notify_all()

    # ---- 取的一侧（等待循环所在）----

    @property
    def dead(self) -> bool:
        """这条流断了（EOF / 连接错 / 收摊没成功）。"""
        with self._cond:
            return self._dead

    def drain(self) -> list[dict[str, Any]]:
        """把这一口气的事件收走：等到头一个，之后只要还在来就接着收。

        等的是**时间**（条件变量的超时），不是 socket 上的读超时——读超时碰一次就把
        ``http.client`` 的缓冲读废了。安静一阵或到点就交差，把预算检查那一步放出来。
        """
        with self._cond:
            # 先等头一个事件：流断了就别再等，等也没有了。
            if not self._pending and not self._dead and not self._closed:
                self._cond.wait(DRAIN_FIRST_WAIT_SECONDS)
            # 已经有行了：只要还在来就接着收，安静一阵或到点就交差。
            deadline = time.monotonic() + DRAIN_MAX_SECONDS
            while self._pending and time.monotonic() < deadline:
                before = len(self._pending)
                self._cond.wait(DRAIN_QUIET_SECONDS)
                if len(self._pending) == before:
                    break  # 安静一阵到头，这一口气收完了
            events = list(self._pending)
            self._pending.clear()
            return events

    @property
    def silent_for(self) -> float:
        """距上次从这条流上读到任何字节过去了多久（秒）。"""
        with self._cond:
            return self._now() - self._last_byte

    @property
    def stale(self) -> bool:
        """心跳停摆到该判「活着但卡住了」——比等满预算早得多。"""
        return self.silent_for > STALE_AFTER_SECONDS

    def close(self) -> None:
        """收摊：先把 socket 打断，好让堵在读上的线程醒过来。

        收摊的失败不该改变任何已经拿到的结果。
        """
        with self._cond:
            self._closed = True
            self._cond.notify_all()
        sock = socket_of(self._response)
        if sock is not None:
            # shutdown 比 close 靠谱：堵在 recv 上的线程是被它唤醒的，不是被 close。
            with contextlib.suppress(Exception):
                sock.shutdown(socket.SHUT_RDWR)
        with contextlib.suppress(Exception):
            self._response.close()
