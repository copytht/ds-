"""opencode 后台服务的 HTTP 调用：中继里唯一发外部请求的模块。

现场一律先折成 :mod:`dsb.opencode` 认的 outcome 分支，回灌载荷由
``payload_from_outcome`` 负责；这里不产出任何编码后的文本（TOON 归扩展）。

opencode API 以本机实测为准（v2.0.18，实测早于文档与官方 SDK，SDK 的路径是错的）：

- ``GET /api/session/{id}``，读父会话的 ``agent`` / ``model`` / ``location.directory``
  ——只借设置，不借对话；
- ``POST /api/session``，body ``{"title", "agent", "model", "location": {"directory"}}``,
  起一个**零消息**的子会话（dsh 的 spawn 语义），回 ``{"data": Session.Info}``；
  三样缺一不可：不带 ``agent``/``model`` 子会话不答，不带 ``location`` 目录落到服务进程的
  cwd（实测 ``/Users/cu``）——所以 spawn 前**当场验**，缺哪样报哪样（早先缺字段是
  每问干等 120s 才超时，毫无信息量）；
- ``DELETE /api/session/{id}``，收摊时删掉子会话（活期间**不删**：可继续子级要复用）；
- ``POST /api/session/{id}/prompt``，body ``{"text": ...}``，收工回 inbox 记录；
  实测**忙时再 prompt 不排队，是 steer**——新问题被插进没跑完的那一轮里
  （响应体带 ``delivery: "steer"``），所以复用前必须先等它空闲；
- ``POST /api/session/{id}/interrupt``，掐掉当前这一轮、**留着子会话**（回
  ``{"interrupted": true|false}``；空闲时回 ``false``，无害，可以放心多掐）；
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
from dsb.log import log_event
from dsb.opencode import answer_complete, has_assistant

AUTH_USERNAME = "opencode"
SERVICE_BIN = "opencode"
# 一轮问句按**静默**计时，不按墙钟：opencode 只要还在动——事件流上还有它这个会话的事件，
# 或 /message 上有新消息、正文还在长——这一问就一直等；**静默**超过这一段才算超时。
# 早先是两段墙钟（开工 120s + 写完 240s = 360s），模型一旦进长工具循环就会被硬切；改按静默后
# 又发现 240s 对会长时间闷头推理的模型偏紧（真机：一轮里静默过十分钟），于是放到 600s。
DEFAULT_IDLE_TIMEOUT = 600.0
# 这里**不设**「整轮墙钟」的硬顶：一次委派能跑多久交给 opencode 自己的闸——`agent.*.steps`
# 限迭代次数、provider 的 `timeout` 限单次请求；中继只管**静默**。硬顶留在中继这边只会变成
# 一道看不见的墙（长任务被谁切的都说不清），所以撤了（见 ADR-0006）。
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
# 复用子会话时换这个框：此时**已经有**此前的问答（dsh 的 continuable，多轮委派），
# 再说「没有任何对话」就是骗它。后半段的纪律跟首问一模一样——框架变了，
# 「只答问题本身」这条不能跟着松。
CONTINUE_ROLE = (
    "同一次委派里的后续问题：这个子会话里已经有此前的问答，接着往下答。"
    "只回答问题本身：不要描述你在哪个会话里，不要解释你的环境，"
    "不要复述问题，也不要重讲已经答过的内容，直接给新的答复正文。\n\n问题："
)


def answer_prompt(question: str, *, followup: bool = False) -> str:
    """页面问题 → 子 agent 看到的那条消息（首问带角色框，后续问换续问框）。

    ``followup`` 只看**这个子会话**收没收到过消息，不看问了几轮——换了个新子会话
    （旧的被删了或换了 opencode 实例）就重新从 :data:`CHILD_ROLE` 起步。
    """
    return f"{CONTINUE_ROLE if followup else CHILD_ROLE}{question}"


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


def message_mark(messages: list[dict[str, Any]]) -> tuple[int, int, int]:
    """一轮消息的形状指纹（条数、最后一条的创建时刻、正文总长）。

    只用来认「还在长」：形状一变就说明 opencode 又有动静了（新消息、正文加字），
    给静默计时续上。事件流缺席时它是唯一的「在动」依据。
    """
    total = 0
    for message in messages:
        for part in message.get("parts") or []:
            if isinstance(part, Mapping):
                text = part.get("text")
                if isinstance(text, str):
                    total += len(text)
    last = created_ms(messages[-1]) if messages else 0
    return (len(messages), last, total)


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
    """子会话**起一次、反复用**（dsh 的 continuable）：每问往同一个 id 里送，等它答完
    再把消息体折成 outcome 交出去。主 agent 是页面那边的模型，本机主对话不参与。"""

    def __init__(
        self,
        session_id: str | None,
        *,
        service_reader: Callable[[], Mapping[str, Any]] = read_service,
        urlopen: Callable[..., Any] = urllib.request.urlopen,
        coordinator_id: str | None = None,
        idle_timeout: float = DEFAULT_IDLE_TIMEOUT,
        poll_interval: float = DEFAULT_POLL_INTERVAL,
        http_timeout: float = DEFAULT_HTTP_TIMEOUT,
        now: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
        wall_clock: Callable[[], float] = time.time,
    ) -> None:
        self._session_id = session_id
        self._service_reader = service_reader
        self._urlopen = urlopen
        self._coordinator_id = coordinator_id
        self._idle_timeout = idle_timeout
        self._poll_interval = poll_interval
        self._http_timeout = http_timeout
        self._now = now
        self._sleep = sleep
        self._wall_clock = wall_clock
        self._cached: Mapping[str, Any] | None = None
        self._progress = AskProgress()
        # 可继续子级的三样现场状态：id（跨问复用）、这一轮是首问还是续问、
        # 以及「一个子会话同时只接一轮」的那把锁（后到的问句排队，见 ask）。
        self._child_id: str | None = None
        self._prompted = False
        self._ask_lock = threading.Lock()

    @property
    def progress(self) -> AskProgress:
        """在途问句的现场进度（`GET /status` 就读它）。"""
        return self._progress

    def warm_up(self) -> bool:
        """启动时现读一次端口与口令；读不到返回 False，之后按请求重试。"""
        return self._service() is not None

    def ask(self, question: str) -> Mapping[str, Any]:
        """问一句 → outcome（``success`` 带消息体，其余是失败分支）。

        主 agent 是**页面上的 DeepSeek 模型**——它排一个围栏就是一次调用；委派链上的
        父级是它，历史也在它那边，所以子会话不带本机这条主对话的任何内容，本机主对话
        全程不排队、不阻塞、也不参与。

        子会话是**可继续**的：起一次，之后每问都往同一个 id 里送，上一轮的问答留给
        下一轮当上下文（后期会被反复调用）。所以每问都得先办三件事——

        1. **排队**：一个子会话同时只接一轮，后到的问句在锁上等（一个 id 上的轮次
           串行，才谈得上「接着往下答」）；
        2. **等空闲**：复用前先等上一轮收干净。忙时 prompt 不是排队而是 steer，新问题
           会被插进没跑完的那一轮里（真机实测 ``delivery: "steer"``）；
        3. **掐尾巴**：这一轮没答成，剩下的半个轮次就地掐掉，别拖到下一问。

        三件事都只动**子会话**，主对话和页面谁都不碰。
        """
        if not self._session_id:
            # 没有 sessionID：在线协议的错误码里没有专码，走非预期响应兜底。
            return {"kind": "unexpected"}
        service = self._service()
        if service is None:
            return {"kind": "not-running"}
        with self._ask_lock:
            self._progress.begin()
            # 只有一个界：**静默**超过 idle_timeout 才判超时；只要 opencode 还在动就一直等。
            # 「能跑多久」不归中继管——那是 opencode 的 `agent.steps` / provider `timeout` 的事。
            started = self._now()
            child_id: str | None = None
            try:
                child_id, reused = self._ensure_child(service)
                if reused:
                    self._quiesce(service, child_id, started + self._idle_timeout)
                # 事件流抢在 prompt 之前挂上：晚一步就吃不到 execution.started，
                # 轮到「开工」那一步的现场就白瞎了。挂不上不是错，等待会退化成老的阻塞 wait。
                stream = self._open_events(service)
                try:
                    baseline_ms = int(self._wall_clock() * 1000)
                    self._call(
                        service,
                        "POST",
                        f"/api/session/{child_id}/prompt",
                        {"text": answer_prompt(question, followup=self._prompted)},
                    )
                    self._prompted = True  # 消息真送进去了，下一问才轮到续问那个框
                    outcome = self._await_answer(service, child_id, baseline_ms, started, stream)
                finally:
                    if stream is not None:
                        stream.close()
                if outcome["kind"] != "success":
                    # 子会话留着复用，但**这一轮**不能留：超时/断流时它可能还在写，
                    # 下一问会被 steer 进这半个轮次里。
                    self._interrupt(service, child_id)
                return outcome
            except Exception as exc:  # 任何现场都折成可识别分支，不往外抛裸堆栈
                # 异常退出同样算没答成（等消息那个 GET 半路炸了也算）：掐一轮再折算。
                if child_id is not None:
                    self._interrupt(service, child_id)
                outcome = outcome_from_exception(exc)
                if outcome["kind"] == "not-running":
                    self._cached = None  # 服务可能换了端口，下次请求现读
                return outcome
            finally:
                self._progress.finish()  # 无论成败，/status 都不能留个幽灵问句

    def _ensure_child(self, service: Mapping[str, Any]) -> tuple[str, bool]:
        """这次要用的子会话，回 ``(id, 是不是复用)``
        ——缓存的那个还活着就接着用，没了或压根没有就新起一个。

        先 GET 一遍只为认出「会话没了」——被人删过、或 opencode 换过实例。**只有 4xx
        算没**（会话层面的否定）：5xx 与连不上照原样抛出去，由 ``ask`` 折成对应分支，
        别把「服务出故障」误判成「会话没了」而白起一个新子会话。
        """
        if self._child_id is not None:
            try:
                self._call(service, "GET", f"/api/session/{self._child_id}")
                return self._child_id, True
            except urllib.error.HTTPError as exc:
                if not 400 <= exc.code < 500:
                    raise
                self._child_id = None  # 会话没了：下面重新起一个
        # 新子会话空着出生：记账清零，下一问从首问那个框起。
        self._child_id = self._spawn(service)
        self._prompted = False
        return self._child_id, False

    def _quiesce(self, service: Mapping[str, Any], child_id: str, deadline: float) -> None:
        """等复用的子会话空闲，再把新问题送进去；等不到就掐掉那一轮继续。

        时间吃**静默**那一段的总账（``deadline`` 是这一问进门时划的 idle 窗口）：
        上一轮的尾巴再长，也不能把总账拖过 idle 窗口。掐掉是安全的——那一轮的答复早已
        交出去，剩下的输出本来也不会被读（下一轮的 baseline 已经划在这之后）。尾巴本身
        也短：真机探过，正文是一次给全的（长度 0 → 338，没有半截状态），所以这一等通常
        只有一瞬。
        """
        remaining = deadline - self._now()
        if remaining <= 0:
            self._interrupt(service, child_id)
            return
        try:
            self._call(
                service,
                "POST",
                f"/api/experimental/session/{child_id}/wait",
                timeout=remaining,
            )
        except Exception:
            self._interrupt(service, child_id)

    def _interrupt(self, service: Mapping[str, Any], child_id: str) -> None:
        """掐掉子会话当前这一轮，**子会话本身留着**（dsh 的 interrupt）。失败只吞掉。

        实测空闲时回 ``{"interrupted": false}``，无害——所以宁可多掐一次，也别让
        孤儿轮次拖累下一问。
        """
        with contextlib.suppress(Exception):  # 掐不掉也改不了这一问的结论
            self._call(service, "POST", f"/api/session/{child_id}/interrupt")

    def dispose(self) -> None:
        """收摊时删掉这次起的子会话（进程崩溃漏下的那些管不了，下次问会另起一个）。"""
        service = self._service()
        if service is None or self._child_id is None:
            return
        self._dispose(service, self._child_id)
        self._child_id = None
        self._prompted = False

    def _spawn(self, service: Mapping[str, Any]) -> str:
        """起一个**零消息**的子会话，返回它的 id（dsh 的 spawn：空对话起步）。

        借父会话的只有设置——``agent``、``model``、工作目录，跟 dsh 的 spawn 一样，
        **不借对话**：委派链上的父级是网页那边的模型，它的历史不在 opencode 里；
        本机主对话是另一个 agent，把它的历史喂进去就是给子 agent 塞无关上下文。

        三样是「子会话能不能干活」的前置条件，缺了**当场报**：早先缺 ``agent``/``model``
        是每问干等 120s 才超时，缺 ``location`` 更是静默把工作目录写成服务进程的 cwd——
        两种慢/静默失败对排查一点信息量都没有，而 spawn 一个中继只干一次。
        """
        parent = self._call(service, "GET", f"/api/session/{self._session_id}")
        settings = parent.get("data") if isinstance(parent, Mapping) else None
        location = settings.get("location") if isinstance(settings, Mapping) else None
        directory = location.get("directory") if isinstance(location, Mapping) else None
        agent = settings.get("agent") if isinstance(settings, Mapping) else None
        model = settings.get("model") if isinstance(settings, Mapping) else None
        missing = [
            name
            for name, value in (("agent", agent), ("model", model), ("location", directory))
            if not value
        ]
        if missing:
            log_event("spawn-missing", missing="/".join(missing))
            raise ServiceUnavailable(f"父会话缺 {'/'.join(missing)}，子会话起不来")
        body: dict[str, Any] = {
            "title": CHILD_TITLE,
            "agent": agent,
            "model": model,
            "location": {"directory": directory},
        }
        spawned = self._call(service, "POST", "/api/session", body)
        child = spawned.get("data") if isinstance(spawned, Mapping) else None
        child_id = child.get("id") if isinstance(child, Mapping) else None
        if not isinstance(child_id, str) or not child_id:
            raise ServiceUnavailable("spawn 出来的子会话没有 id")
        return child_id

    def _dispose(self, service: Mapping[str, Any], child_id: str) -> None:
        """删掉子会话（只在收摊时走）。删不掉只吞掉：这一步从来不该改判别的结论。"""
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

    def say(self, text: str) -> None:
        """把网页说给人听的话**推进协调者的会话**（就是那条与用户对话的 opencode 会话）。

        没有协调者 id 就什么都不做——话仍在 ``/said`` 里等人取。推失败只吞掉：让人看见
        这件事不该改判任何结论。
        """
        service = self._service()
        if service is None or not self._coordinator_id:
            return
        with contextlib.suppress(Exception):
            self._call(
                service,
                "POST",
                f"/api/session/{self._coordinator_id}/prompt",
                {"text": f"web:{text}"},
            )

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
        started: float,
        stream: EventStream | None = None,
    ) -> Mapping[str, Any]:
        """等到 baseline 之后确实出现一条**已定稿**的答复为止。

        **在动就不算超时**：``last_activity`` 记的是「这一问的现场还在往前走」——事件流上
        还有本会话的事件，或 ``/message`` 上有新消息、正文还在长——只要在动，静默窗口就
        跟着往后推；**静默**满 ``idle_timeout`` 才判超时。这里没有「整轮墙钟」的硬顶：能跑
        多久归 opencode 的 ``agent.steps`` / provider ``timeout`` 管（见 ADR-0006）。

        等待的节拍交给事件流：每圈先把 ``/api/event`` 上到手的事件倒干净（顺带记下现场
        进度），流断了或心跳停摆就当场判死，不再陪 opencode 等到预算用完。正文判定一步
        没改，仍以 ``/message`` 为准——事件只当信号，不当内容。
        """
        last_activity = started
        mark: tuple[int, int, int] | None = None
        session = f"/api/session/{session_id}"
        while True:
            now = self._now()
            idle_left = self._idle_timeout - (now - last_activity)
            if idle_left <= 0:
                self._progress.tick(0.0)
                return {"kind": "timeout"}
            if stream is None:
                # 没有事件流（挂不上）：退回老办法，阻塞到子会话空闲；它只在会话空闲
                # 或超时才回——没有事件就认不出「在动」，这一段的静默只能靠 wait 兜。
                self._call(
                    service,
                    "POST",
                    f"/api/experimental/session/{session_id}/wait",
                    timeout=idle_left,
                )
            else:
                events = stream.drain()
                self._progress.note(events, session_id)
                if stream.dead or stream.stale:
                    # opencode 断了，或者活着但心跳停摆：这一秒就知道，不等预算。
                    self._progress.tick(idle_left)
                    return {"kind": "not-running"}
                if any(session_id_of(event) == session_id for event in events):
                    last_activity = self._now()  # 本会话上有事件 = 在动
            fresh = fresh_messages(
                self._call(service, "GET", f"{session}/message{MESSAGE_QUERY}"),
                baseline_ms,
            )
            if fresh is None:
                return {"kind": "unexpected"}
            current = message_mark(fresh)
            if current != mark:
                mark = current
                last_activity = self._now()  # 消息侧还在长 = 在动
            if answer_complete(fresh):
                self._progress.done()
                return {"kind": "success", "body": fresh}
            if has_assistant(fresh):
                self._progress.writing()  # 事件流缺席时，靠正文侧认出「开写了」
            remaining = max(self._idle_timeout - (self._now() - last_activity), 0.0)
            self._progress.tick(remaining)
            self._sleep(min(self._poll_interval, remaining))

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
