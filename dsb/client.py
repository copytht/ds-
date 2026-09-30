"""opencode 后台服务的 HTTP 调用：中继里唯一发外部请求的模块。

现场一律先折成 :mod:`dsb.opencode` 认的 outcome 分支，回灌载荷由
``payload_from_outcome`` 负责；这里不产出任何编码后的文本（TOON 归扩展）。

opencode API 以本机实测为准（v2.0.18，实测早于文档与官方 SDK，SDK 的路径是错的）：

- ``GET /api/session/{id}``，读父会话的 ``agent`` / ``model`` / ``location.directory``
  ——只借设置，不借对话；
- ``POST /api/session``，body ``{"title", "agent", "model", "location": {"directory"}}``,
  起一个**零消息**的子会话（dsh 的 spawn 语义），回 ``{"data": Session.Info}``；
  三样缺一不可：不带 ``agent``/``model`` 子会话不答，不带 ``location`` 目录落到服务进程的
  cwd（实测 ``/Users/cu``）；
- ``DELETE /api/session/{id}``，删掉用完的子会话；
- ``POST /api/session/{id}/prompt``，body ``{"text": ...}``，收工回 inbox 记录；
- ``GET /api/event``，SSE 事件流（见 :mod:`dsb.events`）：等待期的实时信号，
  断流即 opencode 死了；挂不上时才退回
  ``POST /api/experimental/session/{id}/wait``（阻塞到该会话空闲，回 204）；
- ``GET /api/session/{id}/message?order=desc&limit=200``，回 ``{"data": [...], "cursor": ...}``；
- ``GET /api/session/active``，回 ``{"data": {会话 id: {"type": "running"}}}``，
  用来探 opencode 活没活（``probe()``）；
- Basic 认证：用户名 ``opencode``，口令现读自 ``opencode service get password``；
- 端口现读自 ``opencode service status`` 的最后一个非空行。

口令只在内存里待着：不落盘、不打印、不进任何仓库文件。
"""

from __future__ import annotations

import base64
import contextlib
import json
import subprocess
import threading
import time
import urllib.error
import urllib.request
from collections.abc import Callable, Iterable, Mapping
from typing import Any

from dsb.config import parse_password, parse_service_endpoint
from dsb.events import (
    EVENT_EXECUTION_STARTED,
    EVENT_PATH,
    EVENT_TEXT_DELTA,
    EVENT_TEXT_STARTED,
    OPEN_TIMEOUT_SECONDS,
    EventStream,
    delta_of,
    make_reads_block,
    session_id_of,
)
from dsb.opencode import extract_answer, has_assistant

AUTH_USERNAME = "opencode"
SERVICE_BIN = "opencode"
# 两段等待，两个预算（真机 #14：一个 140s 的共享预算被吃掉，答复 212s 才出来，
# 页面只等到了 opencode-timeout —— 分开算是为了让第二段永远不被第一段挤占）。
# 第一段是**开工**：spawn 出来的子会话恒为空闲、零消息，没有「排队」这回事，这里等的
# 只是模型多久吐出第一条 assistant 消息（真机实测 8s）。给 120s 覆盖冷启动与限流；
# 配置坏了也最多让页面等 2 分钟，而不是 fork 时代那个为「等主对话空出来」留的 600s。
DEFAULT_START_TIMEOUT = 120.0
# 第二段是**写完**：一旦出现 assistant 消息就换这段预算重新计时，直到正文齐。
DEFAULT_ANSWER_TIMEOUT = 240.0
DEFAULT_POLL_INTERVAL = 0.5
DEFAULT_HTTP_TIMEOUT = 10.0
SERVICE_READ_TIMEOUT = 10.0
MESSAGE_PAGE_SIZE = 200
MESSAGE_QUERY = f"?order=desc&limit={MESSAGE_PAGE_SIZE}"
# 探活只问「在不在」，本机一条往返，给 2s 足够——慢过这个就是有问题。
PROBE_TIMEOUT = 2.0

# 等待期的四个阶段，供 GET /status 转述（图标角标与悬停吃的就是它）。
PHASE_IDLE = "idle"
PHASE_QUEUED = "queued"
PHASE_RUNNING = "running"
PHASE_WRITING = "writing"
PHASE_DONE = "done"

# 子 agent 的开场白。子会话**空着出生**（spawn：没有此前的对话），照 dsh 的做法直接
# 把这点讲给模型——它既不用去复述并不存在的上文，也不会点评自己的环境。实测框得不够
# 时它答得像在跟人聊天：点评自己的会话 id、复述分析过程（真机问它「只回这一句」，
# 回来的是一段环境解说）。
CHILD_TITLE = "dsb 子会话"
CHILD_ROLE = (
    "你是一次全新委派里的子 agent：此前没有任何对话，下面这条消息就是全部上下文。"
    "问题来自 DeepSeek 网页，只回答问题本身：不要描述你在哪个会话里，"
    "不要解释你的环境，不要写分析过程或复述问题，直接给答复正文。\n\n问题："
)


def answer_prompt(question: str) -> str:
    """页面问题 → 子 agent 看到的那条消息（带上角色框，见 :data:`CHILD_ROLE`）。"""
    return f"{CHILD_ROLE}{question}"


class ServiceUnavailable(Exception):
    """``opencode service status`` / ``get password`` 现读失败（后台服务没跑）。"""


def _run(run: Callable[..., subprocess.CompletedProcess[str]], argv: list[str]) -> str:
    try:
        result = run(argv, capture_output=True, text=True, timeout=SERVICE_READ_TIMEOUT)
    except (OSError, subprocess.SubprocessError) as exc:
        raise ServiceUnavailable(f"现读失败：{' '.join(argv)}") from exc
    if result.returncode != 0:
        raise ServiceUnavailable(f"现读失败（退出码 {result.returncode}）：{' '.join(argv)}")
    return result.stdout or ""


def read_service(
    run: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
) -> dict[str, Any]:
    """启动时现读服务地址与口令；认不出或读不到一律当「服务没跑」。"""
    try:
        endpoint = parse_service_endpoint(_run(run, [SERVICE_BIN, "service", "status"]))
        password = parse_password(_run(run, [SERVICE_BIN, "service", "get", "password"]))
    except ValueError as exc:
        raise ServiceUnavailable("opencode 服务的现读输出认不出来") from exc
    return {"host": endpoint["host"], "port": endpoint["port"], "password": password}


def normalize_message(message: Mapping[str, Any]) -> dict[str, Any]:
    """opencode 的一条消息 → fixture 认的 ``role`` / ``parts`` 形状（``time`` 留着好判新旧）。

    实测：消息的类型在 ``type``（assistant / user / idle …），正文在 ``content`` 列表；
    user 消息没有 ``content``，正文直接在 ``text`` 字段。
    """
    role = message.get("type")
    if not isinstance(role, str):
        role = message.get("role")
    content = message.get("content")
    parts = content if isinstance(content, list) else []
    if not parts and isinstance(message.get("text"), str):
        parts = [{"type": "text", "text": message["text"]}]
    return {"role": role, "parts": parts, "time": message.get("time")}


def normalize_messages(body: Any) -> list[dict[str, Any]] | None:
    """opencode 的消息响应体 → 消息列表；形状认不出返回 ``None``（折成非预期响应）。"""
    data = body.get("data") if isinstance(body, Mapping) else body
    if not isinstance(data, list):
        return None
    messages: list[dict[str, Any]] = []
    for item in data:
        if not isinstance(item, Mapping):
            return None
        messages.append(normalize_message(item))
    return messages


def created_ms(message: Mapping[str, Any]) -> int:
    """一条消息的创建时间（毫秒）；认不出算 0，等同于「比任何 baseline 都早」。"""
    time_field = message.get("time")
    if isinstance(time_field, Mapping):
        created = time_field.get("created")
        if isinstance(created, int | float) and not isinstance(created, bool):
            return int(created)
    return 0


def fresh_messages(body: Any, baseline_ms: int) -> list[dict[str, Any]] | None:
    """只留 baseline 之后的新消息并按时间升序排。

    升序是为了让 :func:`dsb.opencode.extract_answer` 取到「最后一条 assistant」
    ——那才是这轮的答复，而不是上一轮的旧答案。
    """
    messages = normalize_messages(body)
    if messages is None:
        return None
    fresh = [message for message in messages if created_ms(message) > baseline_ms]
    fresh.sort(key=created_ms)
    return fresh


def outcome_from_exception(exc: BaseException) -> dict[str, Any]:
    """异常 → outcome 分支：HTTP 非 2xx 是 ``http-error``，连不上是 ``not-running``。"""
    if isinstance(exc, urllib.error.HTTPError):
        return {"kind": "http-error", "status": exc.code}
    reason = exc.reason if isinstance(exc, urllib.error.URLError) else exc
    if isinstance(reason, TimeoutError) or isinstance(exc, TimeoutError):
        return {"kind": "timeout"}
    if isinstance(reason, OSError | urllib.error.URLError):
        return {"kind": "not-running"}
    return {"kind": "unexpected"}


class AskProgress:
    """一次问句的现场进度，供 ``GET /status`` 转述。

    写它的是 ``ask`` 所在的请求线程，读它的是扩展每隔几秒打过来的另一个线程，
    所以全部走锁；``snapshot()`` 回 ``None`` 表示现在没有问句在途。
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._phase = PHASE_IDLE
        self._written = 0
        self._remaining: float | None = None

    def begin(self) -> None:
        with self._lock:
            self._phase = PHASE_QUEUED
            self._written = 0
            self._remaining = None

    def note(self, events: Iterable[Mapping[str, Any]], session_id: str) -> None:
        """吃掉这一轮事件：只认自己那个子会话的，别人家的会话一概不相干。"""
        with self._lock:
            for event in events:
                if session_id_of(event) != session_id:
                    continue
                kind = event.get("type")
                if kind == EVENT_EXECUTION_STARTED:
                    if self._phase == PHASE_QUEUED:
                        self._phase = PHASE_RUNNING  # agent 循环起来了，开始想
                elif kind in (EVENT_TEXT_STARTED, EVENT_TEXT_DELTA):
                    self._phase = PHASE_WRITING
                    if kind == EVENT_TEXT_DELTA:
                        self._written += len(delta_of(event))
            # 挂不上事件流时，正文侧也认得出「开写了」，阶段照样往前走。

    def writing(self) -> None:
        with self._lock:
            if self._phase in (PHASE_QUEUED, PHASE_RUNNING):
                self._phase = PHASE_WRITING

    def done(self) -> None:
        with self._lock:
            self._phase = PHASE_DONE

    def tick(self, remaining: float | None) -> None:
        """每圈刷新剩余预算；``None`` 表示还没定下用哪一段。"""
        with self._lock:
            self._remaining = remaining

    def finish(self) -> None:
        with self._lock:
            self._phase = PHASE_IDLE
            self._written = 0
            self._remaining = None

    def snapshot(self) -> dict[str, Any] | None:
        with self._lock:
            if self._phase == PHASE_IDLE:
                return None
            remaining = self._remaining
            return {
                "phase": self._phase,
                "written": self._written,
                "remaining": None if remaining is None else round(remaining, 1),
            }


class OpencodeClient:
    """每问起一个空子会话送进 opencode，等它答完再把消息体折成 outcome 交出去。"""

    def __init__(
        self,
        session_id: str | None,
        *,
        service_reader: Callable[[], Mapping[str, Any]] = read_service,
        urlopen: Callable[..., Any] = urllib.request.urlopen,
        start_timeout: float = DEFAULT_START_TIMEOUT,
        answer_timeout: float = DEFAULT_ANSWER_TIMEOUT,
        poll_interval: float = DEFAULT_POLL_INTERVAL,
        http_timeout: float = DEFAULT_HTTP_TIMEOUT,
        now: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
        wall_clock: Callable[[], float] = time.time,
    ) -> None:
        self._session_id = session_id
        self._service_reader = service_reader
        self._urlopen = urlopen
        self._start_timeout = start_timeout
        self._answer_timeout = answer_timeout
        self._poll_interval = poll_interval
        self._http_timeout = http_timeout
        self._now = now
        self._sleep = sleep
        self._wall_clock = wall_clock
        self._cached: Mapping[str, Any] | None = None
        self._progress = AskProgress()

    @property
    def progress(self) -> AskProgress:
        """在途问句的现场进度（`GET /status` 就读它）。"""
        return self._progress

    def warm_up(self) -> bool:
        """启动时现读一次端口与口令；读不到返回 False，之后按请求重试。"""
        return self._service() is not None

    def ask(self, question: str) -> Mapping[str, Any]:
        """问一句 → outcome（``success`` 带消息体，其余是失败分支）。

        每问起一个**空**子会话去答，答完就删。主 agent 是**页面上的 DeepSeek 模型**
        ——它排一个围栏就是一次调用；委派链上的父级是它，历史也在它那边，所以子会话
        不带本机这条主对话的任何内容，本机主对话全程不排队、不阻塞、也不参与。
        """
        if not self._session_id:
            # 没有 sessionID：在线协议的错误码里没有专码，走非预期响应兜底。
            return {"kind": "unexpected"}
        service = self._service()
        if service is None:
            return {"kind": "not-running"}
        self._progress.begin()
        try:
            child_id = self._spawn(service)
            # 事件流抢在 prompt 之前挂上：晚一步就吃不到 execution.started，
            # 「开工」这一段的现场就白瞎了。挂不上不是错，等待会退化成老的阻塞 wait。
            stream = self._open_events(service)
            try:
                baseline_ms = int(self._wall_clock() * 1000)
                self._call(
                    service,
                    "POST",
                    f"/api/session/{child_id}/prompt",
                    {"text": answer_prompt(question)},
                )
                return self._await_answer(service, child_id, baseline_ms, stream)
            finally:
                if stream is not None:
                    stream.close()
                # 子会话用完即弃：留着会在会话列表里堆一排「dsb 子会话」。
                self._dispose(service, child_id)
        except Exception as exc:  # 任何现场都折成可识别分支，不往外抛裸堆栈
            outcome = outcome_from_exception(exc)
            if outcome["kind"] == "not-running":
                self._cached = None  # 服务可能换了端口，下次请求现读
            return outcome
        finally:
            self._progress.finish()  # 无论成败，/status 都不能留个幽灵问句

    def _spawn(self, service: Mapping[str, Any]) -> str:
        """起一个**零消息**的子会话，返回它的 id（dsh 的 spawn：空对话起步）。

        借父会话的只有设置——``agent``、``model``、工作目录，跟 dsh 的 spawn 一样，
        **不借对话**：委派链上的父级是网页那边的模型，它的历史不在 opencode 里；
        本机主对话是另一个 agent，把它的历史喂进去就是给子 agent 塞无关上下文。
        """
        parent = self._call(service, "GET", f"/api/session/{self._session_id}")
        settings = parent.get("data") if isinstance(parent, Mapping) else None
        body: dict[str, Any] = {"title": CHILD_TITLE}
        if isinstance(settings, Mapping):
            for key in ("agent", "model"):
                if settings.get(key) is not None:
                    body[key] = settings[key]
            location = settings.get("location")
            directory = location.get("directory") if isinstance(location, Mapping) else None
            if isinstance(directory, str) and directory:
                body["location"] = {"directory": directory}
        spawned = self._call(service, "POST", "/api/session", body)
        child = spawned.get("data") if isinstance(spawned, Mapping) else None
        child_id = child.get("id") if isinstance(child, Mapping) else None
        if not isinstance(child_id, str) or not child_id:
            raise ServiceUnavailable("spawn 出来的子会话没有 id")
        return child_id

    def _dispose(self, service: Mapping[str, Any], child_id: str) -> None:
        """删掉子会话。删不掉不外抛：答复已经拿到，不能因为收尾失败改判结果。"""
        with contextlib.suppress(Exception):  # 收尾失败只该被吞掉
            self._call(service, "DELETE", f"/api/session/{child_id}")

    def _service(self) -> Mapping[str, Any] | None:
        if self._cached is None:
            try:
                self._cached = self._service_reader()
            except Exception:  # 现读失败一律当「服务没跑」，由调用方回错误码
                return None
        return self._cached

    def _open_events(self, service: Mapping[str, Any]) -> EventStream | None:
        """挂上 opencode 的事件流；挂不上回 ``None``（等待退化成老的阻塞 wait）。

        挂不上不算错：版本变了、口令换了，等待仍得继续，只是失去「断流当场判死」
        与「进度现场」这两样——不值得因为监控挂不上就把整条问答链掐了。
        """
        url = f"http://{service['host']}:{service['port']}{EVENT_PATH}"
        request = urllib.request.Request(
            url,
            method="GET",  # 显式给 method：不给的话 Request 上没有这个属性
            headers={
                "Authorization": _basic_auth(str(service["password"])),
                "Accept": "text/event-stream",
            },
        )
        try:
            # 超时只管握手（连上 + 等响应头）：读要改成无限等，超时抛一次
            # http.client 的缓冲读就废了，这条流再也读不出字节。
            response = self._urlopen(request, timeout=OPEN_TIMEOUT_SECONDS)
        except Exception:
            return None
        if not make_reads_block(response):
            with contextlib.suppress(Exception):  # 认不出 socket 就别拿这条流冒险
                response.close()
            return None
        stream = EventStream(response, now=self._now)
        stream.start()  # 读挂到自己的线程上，主线程只管取
        return stream

    def probe(self) -> str:
        """opencode 还在不在：现打一条 ``/api/session/active``，回 ``up`` / ``down``。

        问句之外的空档全靠它——中继自己活着不代表 opencode 活着，而这两件事
        出事时长得一模一样（都是「连不上」），分开了才知道该重启哪个。
        """
        service = self._service()
        if service is None:
            return "down"
        try:
            self._call(service, "GET", "/api/session/active", timeout=PROBE_TIMEOUT)
        except Exception:
            self._cached = None  # 端口/口令可能变了，下次请求现读
            return "down"
        return "up"

    def status(self) -> Mapping[str, Any]:
        """``GET /status`` 的载荷：现在有没有问句在途，在途的话走到哪一步了。"""
        return {"status": "ok", "ask": self._progress.snapshot()}

    def _await_answer(
        self,
        service: Mapping[str, Any],
        session_id: str,
        baseline_ms: int,
        stream: EventStream | None = None,
    ) -> Mapping[str, Any]:
        """等到 baseline 之后确实出现一条带正文的答复为止。

        两段预算：还没见到 assistant 消息时算「开工」（模型多久吐第一条消息），
        一旦见到就换成「写完」预算重新计时——后一段永远不被前一段挤占。

        等待的节拍交给事件流：每圈先把 ``/api/event`` 上到手的事件倒干净（顺带
        记下现场进度），流断了或心跳停摆就当场判死，不再陪 opencode 等到预算用完。
        正文判定一步没改，仍以 ``/message`` 为准——事件只当信号，不当内容。
        """
        start_deadline = self._now() + self._start_timeout
        answer_deadline: float | None = None
        session = f"/api/session/{session_id}"
        while True:
            deadline = answer_deadline if answer_deadline is not None else start_deadline
            remaining = deadline - self._now()
            if remaining <= 0:
                return {"kind": "timeout"}
            if stream is None:
                # 没有事件流（挂不上）：退回老办法，阻塞到子会话空闲；如果它抢在
                # agent 循环启动前就返回，下面会因为拿不到答复正文而再转一圈。
                self._call(
                    service,
                    "POST",
                    f"/api/experimental/session/{session_id}/wait",
                    timeout=remaining,
                )
            else:
                self._progress.note(stream.drain(), session_id)
                if stream.dead or stream.stale:
                    # opencode 断了，或者活着但心跳停摆：这一秒就知道，不等预算。
                    self._progress.tick(remaining)
                    return {"kind": "not-running"}
            self._progress.tick(remaining)
            fresh = fresh_messages(
                self._call(service, "GET", f"{session}/message{MESSAGE_QUERY}"),
                baseline_ms,
            )
            if fresh is None:
                return {"kind": "unexpected"}
            if extract_answer(fresh) is not None:
                self._progress.done()
                return {"kind": "success", "body": fresh}
            # 答复开写了就换预算：正文可能还空着，但已经在写了。
            if answer_deadline is None and has_assistant(fresh):
                answer_deadline = self._now() + self._answer_timeout
                self._progress.writing()  # 事件流缺席时，靠正文侧认出「开写了」
            self._sleep(min(self._poll_interval, max(deadline - self._now(), 0.0)))

    def _call(
        self,
        service: Mapping[str, Any],
        method: str,
        path: str,
        payload: Mapping[str, Any] | None = None,
        timeout: float | None = None,
    ) -> Any:
        url = f"http://{service['host']}:{service['port']}{path}"
        data = None
        if payload is not None:
            data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        request = urllib.request.Request(
            url,
            data=data,
            method=method,
            headers={
                "Authorization": _basic_auth(str(service["password"])),
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
        )
        timeout = self._http_timeout if timeout is None else timeout
        with self._urlopen(request, timeout=timeout) as response:
            raw = response.read()
        if not raw.strip():
            return None
        return json.loads(raw)


def _basic_auth(password: str) -> str:
    token = base64.b64encode(f"{AUTH_USERNAME}:{password}".encode()).decode()
    return f"Basic {token}"
