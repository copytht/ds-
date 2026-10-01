"""页面动作服务（ADR-0007）：agent 提交动作、扩展经 SSE 订阅执行、结果原地回传。

三条线上的端点：

- ``POST /action``（写端点）：头 ``Authorization: Bearer <token>``，阻塞到扩展回传，
  原地返回 ``{"ok": true, "action", "result"}`` 或 ``{"ok": false, "action", "error"}``；
- ``GET /actions``（动作流，SSE）：扩展订它收动作，帧形如
  ``data: {"type":"action","id","action","params","target"}``，连上先来一条
  ``{"type":"subscribed"}``，空档每 15s 一行 ``: heartbeat`` 注释（形状照抄 dsb/events.py）；
- ``POST /action/result``（扩展回传）：``{"id","ok","result"|"error"}``，**不验 token**——
  扩展给不到 token，读侧靠「不下发 CORS 头 + 只认扩展来源」兜（ADR-0007 分头认）。

失败码册子固定六个，与 ``protocol/fixtures/action.json`` 同一份：
``unauthorized`` / ``no-subscriber`` / ``disabled`` / ``unknown-action`` /
``timeout`` / ``tab-gone``。
同 ``target`` 的动作按提交顺序串行（一把 target 一把锁），不同 target 各走各的、互不阻塞。
"""

from __future__ import annotations

import json
import os
import queue
import secrets
import select
import socket
import threading
from collections.abc import Iterator, Mapping
from pathlib import Path
from typing import Any

from dsb.config import ACTION_TOKEN_PATH, parse_session_id
from dsb.opencode import ERROR_UNEXPECTED

ACTION_PATH = "/action"
ACTIONS_PATH = "/actions"
ACTION_RESULT_PATH = "/action/result"

ERROR_UNAUTHORIZED = "unauthorized"
ERROR_NO_SUBSCRIBER = "no-subscriber"
ERROR_DISABLED = "disabled"

#: 不受总开关管的两件动作：开关本身的读写。关掉后还得能把开关翻回来，
#: 否则就是「把遥控器锁进被遥控的盒子里」。
TOGGLE_ACTIONS = frozenset({"toggle.get", "toggle.set"})
ERROR_UNKNOWN_ACTION = "unknown-action"
ERROR_TIMEOUT = "timeout"
ERROR_TAB_GONE = "tab-gone"

#: 写端点的失败码册子（一字不差，与 protocol/fixtures/action.json 对齐）。
ACTION_ERRORS = frozenset(
    {
        ERROR_UNAUTHORIZED,
        ERROR_NO_SUBSCRIBER,
        ERROR_DISABLED,
        ERROR_UNKNOWN_ACTION,
        ERROR_TIMEOUT,
        ERROR_TAB_GONE,
    }
)

#: 名册最小集：ADR-0007 的只读动作。中继只判名字（执行是扩展的事），认不出就 unknown-action。
READ_ACTIONS = frozenset(
    {"tabs.list", "page.state", "composer.read", "messages.list", "messages.last"}
)

#: 写动作占位：还没实现，**不进名册**——提交它们会落 unknown-action，实现后再并进 KNOWN_ACTIONS。
WRITE_ACTIONS = (
    "stop.click",
    "wait.reply",
    "wait.fence",
)

#: 名册：只读那批 + 已落地的写动作（`composer.*` 已实现，进名册）。
KNOWN_ACTIONS = READ_ACTIONS | frozenset(
    {
        "composer.type",
        "composer.clear",
        "send.click",
        "send.enter",
        "chat.new",
        "toggle.get",
        "toggle.set",
    }
)

#: 动作流的心跳：照抄 dsb/events.py 的标称间隔（事件流实测 15s 一拍）。
HEARTBEAT_SECONDS = 15.0
#: 推下去等回传的上限：到了没回就判 timeout，锁也放掉，别让同一 target 永远堵着。
ACTION_TIMEOUT_SECONDS = 30.0
#: 动作服务的总开关（配置读）：0/false/no/off 都算关。
ACTIONS_ENABLED_ENV_KEY = "DSB_ACTIONS_ENABLED"
_ACTIONS_OFF = frozenset({"0", "false", "no", "off"})

#: 订阅成功的首帧：扩展收到它才知道动作流真的活着。
SUBSCRIBED_FRAME = b'data: {"type": "subscribed"}\n\n'

Payload = dict[str, Any]


def ensure_token(path: Path | None = None, *, entropy_bytes: int = 32) -> str:
    """动作写端点的 token：不存在就现生成（0600），存在就复用内容不覆盖。

    落点走 ``config.ACTION_TOKEN_PATH``（固定路径，调用方自己读，agent 不手工管）。
    """
    target = ACTION_TOKEN_PATH if path is None else Path(path)
    token = secrets.token_urlsafe(entropy_bytes)
    if target.is_file():
        existing = target.read_text(encoding="utf-8").strip()
        if existing:
            target.chmod(0o600)  # 内容不动，权限按需收紧
            return existing
        target.write_text(token, encoding="utf-8")  # 空文件算没配过，补一个
        target.chmod(0o600)
        return token
    target.parent.mkdir(parents=True, exist_ok=True)
    # O_EXCL + 0600：另一进程同时起也不会踩到，老 umask 压不进来。
    descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        handle.write(token)
    target.chmod(0o600)
    return token


def resolve_enabled(env_text: str) -> bool:
    """动作服务的总开关：进程环境变量优先，其次 ``.env`` 里的 DSB_ACTIONS_ENABLED，缺省关。"""
    raw = os.environ.get(ACTIONS_ENABLED_ENV_KEY) or parse_session_id(
        env_text, ACTIONS_ENABLED_ENV_KEY
    )
    if not raw:
        return False
    return raw.strip().lower() not in _ACTIONS_OFF


def bearer_token(authorization: str | None) -> str | None:
    """``Authorization`` 头 → token 本身；不是 Bearer 一律 None（认不出就不认）。"""
    if authorization is None:
        return None
    scheme, _, value = authorization.partition(" ")
    if scheme.lower() != "bearer":
        return None
    return value.strip() or None


def parse_action_request(body: bytes) -> dict[str, Any] | None:
    """请求体 → ``{"action", "params", "target"}``；不合线协议的一律 None。"""
    try:
        data = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None
    if not isinstance(data, Mapping):
        return None
    name = data.get("action")
    if not isinstance(name, str) or not name.strip():
        return None
    params = data.get("params", {})
    if not isinstance(params, Mapping):
        return None
    target = data.get("target")
    if target is not None and not isinstance(target, str):
        return None
    return {"action": name, "params": dict(params), "target": target}


def action_frame(call_id: str, request: Mapping[str, Any]) -> bytes:
    """动作 → 一行 SSE ``data:`` 帧（ensure_ascii=False，参数里的中文原样过去）。"""
    frame = {
        "type": "action",
        "id": call_id,
        "action": request["action"],
        "params": request["params"],
        "target": request["target"],
    }
    return b"data: " + json.dumps(frame, ensure_ascii=False).encode("utf-8") + b"\n\n"


def peer_alive(sock: Any) -> bool:
    """对端还连着吗（0 读不改任何缓冲、不改阻塞模式）。

    扩展关掉标签页 / service worker 被收走时这里是 no-subscriber 的依据：
    等着永远等不到回传，不如当场报出来。
    """
    try:
        readable, _, _ = select.select([sock], [], [], 0)
    except (OSError, ValueError):
        return False
    if not readable:
        return True
    try:
        return sock.recv(1, socket.MSG_PEEK) != b""
    except OSError:
        return False


class Subscriber:
    """一个连上 ``GET /actions`` 的扩展：帧排队给它，判死看 socket。"""

    def __init__(self, sock: Any) -> None:
        self.sock = sock
        self.queue: queue.Queue[bytes] = queue.Queue()

    def put(self, frame: bytes) -> None:
        self.queue.put(frame)

    def alive(self) -> bool:
        return peer_alive(self.sock)


class ActionServer:
    """动作的登记（订阅者）、排队（按 target 串行）、下发（SSE）与收账（回传）。"""

    def __init__(
        self,
        token: str,
        *,
        enabled: bool = True,
        timeout: float = ACTION_TIMEOUT_SECONDS,
    ) -> None:
        self._token = token
        self.enabled = enabled
        self.timeout = timeout
        self._subscriber: Subscriber | None = None
        self._subscriber_guard = threading.Lock()
        self._target_locks: dict[str, threading.Lock] = {}
        self._target_locks_guard = threading.Lock()
        self._pending: dict[str, dict[str, Any]] = {}
        self._pending_guard = threading.Lock()
        self._issued = 0

    # ---- 订阅与下发 ----

    def subscribe(self, sock: Any) -> Subscriber:
        """登记订阅者：新的顶掉旧的（扩展重连是常态，只留最新的那条）。"""
        subscriber = Subscriber(sock)
        with self._subscriber_guard:
            self._subscriber = subscriber
        return subscriber

    def unsubscribe(self, subscriber: Subscriber) -> None:
        with self._subscriber_guard:
            if self._subscriber is subscriber:
                self._subscriber = None

    def frames(self, subscriber: Subscriber) -> Iterator[bytes]:
        """这条 SSE 的帧序列：先来订阅成功，之后有动作发动作，空档 15s 一行心跳。"""
        yield SUBSCRIBED_FRAME
        while True:
            if not self._is_current(subscriber) or not subscriber.alive():
                return
            try:
                frame: bytes | None = subscriber.queue.get(timeout=HEARTBEAT_SECONDS)
            except queue.Empty:
                frame = None
            if not self._is_current(subscriber) or not subscriber.alive():
                return
            yield b": heartbeat\n\n" if frame is None else frame

    def _is_current(self, subscriber: Subscriber) -> bool:
        with self._subscriber_guard:
            return self._subscriber is subscriber

    def _current_subscriber(self) -> Subscriber | None:
        """活着的那个订阅者；断了就顺手注销（下次提交明确回 no-subscriber）。"""
        with self._subscriber_guard:
            subscriber = self._subscriber
        if subscriber is not None and not subscriber.alive():
            self.unsubscribe(subscriber)
            return None
        return subscriber

    # ---- 提交（阻塞到回传）----

    def submit(self, body: bytes, authorization: str | None) -> tuple[int, Payload]:
        """``POST /action``：按顺序过 鉴权 → 订阅者 → 开关 → 名册，然后入队等结果。

        顺序定死成这样（便宜的先挡），测试与文档都按它来。
        """
        request = parse_action_request(body)
        if request is None:
            # 请求本身不合线协议：跟 /send 一个脾气，非预期响应兜底。
            return 400, {"ok": False, "action": "", "error": ERROR_UNEXPECTED}
        name = request["action"]
        if bearer_token(authorization) != self._token:
            return 401, {"ok": False, "action": name, "error": ERROR_UNAUTHORIZED}
        subscriber = self._current_subscriber()
        if subscriber is None:
            return 200, {"ok": False, "action": name, "error": ERROR_NO_SUBSCRIBER}
        if not self.enabled and name not in TOGGLE_ACTIONS:
            return 200, {"ok": False, "action": name, "error": ERROR_DISABLED}
        if name not in KNOWN_ACTIONS:
            return 200, {"ok": False, "action": name, "error": ERROR_UNKNOWN_ACTION}

        with self._lock_for(request["target"]):
            # 拿到锁再看一眼：等前一个动作时扩展可能刚断线。
            if self._current_subscriber() is not subscriber:
                return 200, {"ok": False, "action": name, "error": ERROR_NO_SUBSCRIBER}
            call_id, waiter = self._register()
            subscriber.put(action_frame(call_id, request))
            if not waiter["event"].wait(self.timeout):
                self._forget(call_id)
                return 200, {"ok": False, "action": name, "error": ERROR_TIMEOUT}
        outcome = waiter["response"]
        if outcome["ok"]:
            return 200, {"ok": True, "action": name, "result": outcome.get("result")}
        error = outcome.get("error")
        return 200, {
            "ok": False,
            "action": name,
            "error": error if isinstance(error, str) and error else ERROR_TIMEOUT,
        }

    def record_result(self, body: bytes) -> tuple[int, Payload]:
        """``POST /action/result``：把扩展回的账记到等着的那次提交上。

        认不出 / 没人等（已经超时收摊的）也回 200——回传是幂等的收尾，不值得让它重试。
        """
        try:
            data = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return 400, {"status": "error", "error": ERROR_UNEXPECTED}
        if not isinstance(data, Mapping):
            return 400, {"status": "error", "error": ERROR_UNEXPECTED}
        call_id, ok = data.get("id"), data.get("ok")
        if not isinstance(call_id, str) or not call_id or not isinstance(ok, bool):
            return 400, {"status": "error", "error": ERROR_UNEXPECTED}
        error = data.get("error")
        if not ok and (not isinstance(error, str) or not error):
            return 400, {"status": "error", "error": ERROR_UNEXPECTED}

        with self._pending_guard:
            waiter = self._pending.pop(call_id, None)
        if waiter is None:
            return 200, {"status": "ok"}  # 超时后才回：账已经收了，别让它重来
        waiter["response"] = {"ok": ok, "result": data.get("result"), "error": error}
        waiter["event"].set()
        return 200, {"status": "ok"}

    # ---- 内部 ----

    def _lock_for(self, target: str | None) -> threading.Lock:
        """一把 target 一把锁：同标签页按提交顺序串行，别的标签页各走各的。"""
        key = target or ""
        with self._target_locks_guard:
            lock = self._target_locks.get(key)
            if lock is None:
                lock = threading.Lock()
                self._target_locks[key] = lock
            return lock

    def _register(self) -> tuple[str, dict[str, Any]]:
        with self._pending_guard:
            self._issued += 1
            # id 得猜不着：回传端点不验 token，认人全靠这个 id。
            call_id = f"{self._issued:x}-{secrets.token_urlsafe(12)}"
            waiter: dict[str, Any] = {"event": threading.Event(), "response": None}
            self._pending[call_id] = waiter
        return call_id, waiter

    def _forget(self, call_id: str) -> None:
        with self._pending_guard:
            self._pending.pop(call_id, None)
