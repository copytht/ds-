"""dsh 子会话宿主的 stdio 调用：中继里唯一与子会话说话的地方。

子会话不再由中继手写编排（起会话 / 等空闲 / 掐尾巴 / 复用），改由
:mod:`native.host` 里的 dsh continuable subagent 负责（ADR-0009）：本机主对话与网页
那一问都只是往同一个 child 的 inbox 里投递。宿主是个 ``node`` 子进程，stdio 上讲行
JSON——一问一行、回应一行，回应带请求的 ``id``，中继按 id 认领。

口径不变的部分：现场一律先折成 :mod:`dsb.opencode` 认的 outcome 分支，回灌载荷由
``payload_from_outcome`` 负责；这里不产出任何编码后的文本（TOON 归扩展）。

宿主是怎么挂的、每轮 spawn 一次 ``opencode run`` 的接缝在哪，都写在
``docs/adr/0009-opencode-behind-a-thin-dsh-llm-adapter.md``。
"""

from __future__ import annotations

import contextlib
import json
import os
import queue
import subprocess
import threading
import uuid
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from dsb.log import log_event

#: 一轮问句的上限。dsh 侧 continuable 是阻塞到本轮终态才回，没有「静默」可看——
#: opencode run 挂住就一路挂着（真机见过一轮跑过十分钟）。墙钟上限因此回来了，
#: 但它量的是**宿主这一趟**，不是模型内部的推理：超了就掐这一轮，子会话留着。
DEFAULT_IDLE_TIMEOUT = 900.0
#: 宿主进程的 cwd：dsh 的 session cwd、子 agent 的工作目录、session 日志都落在它下面。
DEFAULT_CWD = Path(__file__).resolve().parent.parent
HOST_ENTRY = Path(__file__).resolve().parent.parent / "native" / "host.mjs"

#: 认不出页面会话时共用的那一份（原来只有一条会话，现在是「默认那条」）。
DEFAULT_PAGE = "default"

# 等待期的阶段，供 GET /status 转述（图标角标与悬停吃的就是它）。旧链路按 opencode 的
# 事件流区分「排队 / 在写」，宿主这一侧只看得到「在飞」与「空着」两件事，就不装第三种了。
PHASE_IDLE = "idle"
PHASE_RUNNING = "running"

# 子 agent 的开场白。子会话**空着出生**（dsh 的 spawn 语义：没有此前的对话），照 dsh 的
# 做法直接把这点讲给模型——它既不用去复述并不存在的上文，也不会点评自己的环境。实测框得
# 不够时它答得像在跟人聊天：点评自己的会话 id、复述分析过程。
CHILD_ROLE = (
    "你是一次全新委派里的子 agent：此前没有任何对话，下面这条消息就是全部上下文。"
    "问题来自 DeepSeek 网页，只回答问题本身：不要描述你在哪个会话里，"
    "不要解释你的环境，不要写分析过程或复述问题，直接给答复正文。\n\n问题："
)
# 复用子会话时换这个框：此时**已经有**此前的问答（continuable，多轮委派），
# 再说「没有任何对话」就是骗它。后半段的纪律跟首问一模一样。
CONTINUE_ROLE = (
    "同一次委派里的后续问题：这个子会话里已经有此前的问答，接着往下答。"
    "只回答问题本身：不要描述你在哪个会话里，不要解释你的环境，"
    "不要复述问题，也不要重讲已经答过的内容，直接给新的答复正文。\n\n问题："
)


def answer_prompt(question: str, *, followup: bool = False) -> str:
    """页面问题 → 子 agent 看到的那条消息（首问带角色框，后续问换续问框）。

    ``followup`` 只看**这个子会话**收没收到过消息，不看问了几轮——换了个新子会话就该
    重新用首问的框。
    """
    return f"{CONTINUE_ROLE if followup else CHILD_ROLE}{question}"


class ServiceUnavailable(Exception):
    """宿主没起来或起崩了，答不了这一问（outcome 折成 not-running）。"""


class HostProcess:
    """``node native/host.mjs`` 的 stdio 对话：一问一行、回应一行，按 id 认领。

    读口常驻一个线程：问句在途时宿主那边不回话，这个线程得一直读得动，否则
    ``interrupt`` 递不进去、退出时的收摊也做不了。
    """

    def __init__(self, command: list[str], *, cwd: Path) -> None:
        self._cwd = cwd
        self._pending: dict[str, queue.Queue[Mapping[str, Any]]] = {}
        self._guard = threading.Lock()
        self._dead: str | None = None
        try:
            self._proc = subprocess.Popen(  # noqa: S603 - 命令是本仓的固定入口
                command,
                cwd=str(cwd),
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                text=True,
                encoding="utf-8",
                bufsize=1,
                env={**os.environ, "NODE_NO_WARNINGS": "1"},
            )
        except OSError as error:
            raise ServiceUnavailable(f"起不来宿主：{error}") from error
        self._reader = threading.Thread(target=self._read_loop, name="dsh-host", daemon=True)
        self._reader.start()

    def _read_loop(self) -> None:
        assert self._proc.stdout is not None
        for line in self._proc.stdout:
            if not line.strip():
                continue
            try:
                reply = json.loads(line)
            except json.JSONDecodeError:
                continue
            with self._guard:
                box = self._pending.pop(str(reply.get("id")), None)
            if box is not None:
                box.put(reply)
        # 读口退了：把还挂着的人全叫醒，别让它们等一个不会来的回应。
        with self._guard:
            waiting = list(self._pending.values())
            self._pending.clear()
        for box in waiting:
            box.put({"ok": False, "error": "宿主退出了"})

    def call(self, op: str, /, **fields: Any) -> Mapping[str, Any]:
        """发一个 op，等它的回应。宿主那边 ``ok: false`` 一律抛 :class:`ServiceUnavailable`。"""
        if self._proc.poll() is not None:
            raise ServiceUnavailable("宿主不在了")
        call_id = uuid.uuid4().hex
        box: queue.Queue[Mapping[str, Any]] = queue.Queue(1)
        with self._guard:
            self._pending[call_id] = box
        payload = json.dumps({"id": call_id, "op": op, **fields}, ensure_ascii=False)
        assert self._proc.stdin is not None
        try:
            self._proc.stdin.write(payload + "\n")
            self._proc.stdin.flush()
        except (BrokenPipeError, ValueError, OSError) as error:
            with self._guard:
                self._pending.pop(call_id, None)
            raise ServiceUnavailable(f"宿主写不进去：{error}") from error
        reply = box.get()
        if not reply.get("ok", False):
            raise ServiceUnavailable(str(reply.get("error") or "宿主没给好脸"))
        return reply

    def alive(self) -> bool:
        return self._proc.poll() is None

    def close(self) -> None:
        """收摊：先断 stdin 让宿主自己退，再给它一点时间，仍不走就杀掉。"""
        if self._proc.poll() is not None:
            return
        with contextlib.suppress(Exception):
            if self._proc.stdin is not None:
                self._proc.stdin.close()
        try:
            self._proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self._proc.kill()


class SubagentClient:
    """子会话**起一次、反复用**（dsh 的 continuable）：每问往同一个 child 里送，等它答完
    再把答复折成 outcome 交出去。网页那边是主 agent，本机主对话不参与。"""

    def __init__(
        self,
        session_id: str | None,
        *,
        host: HostProcess | None = None,
        idle_timeout: float = DEFAULT_IDLE_TIMEOUT,
        cwd: Path = DEFAULT_CWD,
        command: list[str] | None = None,
    ) -> None:
        self._session_id = session_id
        self._idle_timeout = idle_timeout
        self._owns_host = host is None
        self._host = host or HostProcess(command or ["node", str(HOST_ENTRY)], cwd=cwd)
        # 首问还是续问的框按页面会话分表：同一个 child 的第二轮起才换框。
        # key 是页面会话 id；认不出会话 id 的老调用（curl / 测试）落 "" 这一份。
        self._prompted: dict[str, bool] = {}
        self._send_locks: dict[str, threading.Lock] = {}
        self._locks_guard = threading.Lock()
        self._progress: dict[str, Any] | None = None
        self._progress_guard = threading.Lock()

    @property
    def progress(self) -> dict[str, Any] | None:
        """在途问句的现场进度（``GET /status`` 就读它）。"""
        with self._progress_guard:
            return dict(self._progress) if self._progress is not None else None

    def _lock_for(self, key: str) -> threading.Lock:
        """一条页面会话一把锁：同一个 key 的轮次串行，不同 key 各走各的。

        与 :mod:`dsb.actions` 里按 target 分锁同构——那边管「同标签页串行」，这边管
        「同页面会话串行」；后到的问句在锁上等（串行才谈得上「接着往下答」）。宿主那边
        也按 page 串行，两边都串，双保险。
        """
        with self._locks_guard:
            lock = self._send_locks.get(key)
            if lock is None:
                lock = threading.Lock()
                self._send_locks[key] = lock
            return lock

    def _mark(self, **fields: Any) -> None:
        with self._progress_guard:
            self._progress = {**(self._progress or {}), **fields}

    def _clear(self) -> None:
        with self._progress_guard:
            self._progress = None

    def warm_up(self) -> bool:
        """启动时打一次 ping；宿主没起来返回 False，之后按请求重试。"""
        try:
            self._host.call("ping")
        except ServiceUnavailable:
            return False
        return True

    def send(self, question: str, page_session_id: str | None = None) -> Mapping[str, Any]:
        """问一句 → outcome（``success`` 带答复正文，其余是失败分支）。

        ``page_session_id`` 是**页面会话 id**：每条页面会话各有一个 child、串行、各自的
        首问/续问框，上下文互不串。传 ``None``（curl / 老调用）落到 ``""`` 那一份。

        排队与掐尾巴的活儿在宿主那边（inbox 的 queue 投递 + interrupt），这里只管一把
        页面会话锁、拼措辞、超时兜底与 outcome 折算。
        """
        if not self._session_id:
            return {"kind": "unexpected"}
        key = page_session_id or ""
        with self._lock_for(key):
            self._mark(phase=PHASE_RUNNING, question=question)
            try:
                return self._ask(key, question)
            finally:
                self._clear()  # 收摊就别在 /status 上留幽灵问句

    def _ask(self, key: str, question: str) -> Mapping[str, Any]:
        """一把锁里的一轮：拼措辞、发给宿主、把宿主的回应折成 outcome。"""
        timer = threading.Timer(self._idle_timeout, self._interrupt, args=(key,))
        timer.daemon = True
        timer.start()
        try:
            reply = self._host.call(
                "ask",
                page=self._wire(key),
                question=answer_prompt(question, followup=self._prompted.get(key, False)),
            )
        except ServiceUnavailable:
            return {"kind": "not-running"}
        finally:
            timer.cancel()
        self._prompted[key] = True
        if reply.get("stopReason") != "completed":
            self._interrupt(key)  # 掐掉收摊：别让孤轮拖累下一问
            return {"kind": "timeout" if reply.get("stopReason") == "aborted" else "unexpected"}
        answer = reply.get("answer")
        if not isinstance(answer, str) or not answer.strip():
            return {"kind": "unexpected"}
        return {"kind": "success", "body": answer}

    def _wire(self, key: str) -> str:
        """传给宿主的 page：**非空**（空 id 会拼出坏的 session 落盘路径）。

        认不出页面会话的老调用（curl / 测试）落 ``"default"`` 那一份，与原先单会话行为一致。
        """
        return key or DEFAULT_PAGE

    def _interrupt(self, key: str) -> None:
        """掐掉这一轮，**子会话本身留着**（dsh 的 interrupt）。失败只吞掉。"""
        try:
            self._host.call("interrupt", page=self._wire(key))
        except ServiceUnavailable:
            return

    def say(self, text: str) -> None:
        """把网页说给人听的话推进协调者的会话——**这条路现在没有对家**。

        协调者原本是本机那条与用户对话的 opencode 会话；子会话换成 dsh 之后它不存在了，
        主动推给谁都没得推。正文仍留在 ``/said`` 里等人取（``SaidLog`` 不受这里影响），
        所以丢的是「主动送到眼前」，不是内容。要接回去得先定协调者是什么。
        """
        log_event("said-unrouted", text=len(text))

    def probe(self) -> str:
        """宿主还在不在：打一条 ping，回 ``up`` / ``down``。"""
        try:
            self._host.call("ping")
        except ServiceUnavailable:
            return "down"
        return "up"

    def status(self) -> Mapping[str, Any]:
        """``GET /status`` 的载荷：现在有没有问句在途，在途的话走到哪一步了。"""
        return {"status": "ok", "send": self.progress}

    def dispose(self) -> None:
        """收摊：宿主进程退掉，child 随它一起没（dsh 的 session 日志留在盘上，
        下次起同一个 page 会另起一个 child）。"""
        if self._owns_host:
            self._host.close()


__all__ = [
    "DEFAULT_IDLE_TIMEOUT",
    "DEFAULT_PAGE",
    "HostProcess",
    "ServiceUnavailable",
    "SubagentClient",
    "answer_prompt",
]
