"""opencode 后台服务的 HTTP 调用：中继里唯一发外部请求的模块。

现场一律先折成 :mod:`dsb.opencode` 认的 outcome 分支，回灌载荷由
``payload_from_outcome`` 负责；这里不产出任何编码后的文本（TOON 归扩展）。

opencode API 以本机实测为准（v2.0.18，实测早于文档与官方 SDK，SDK 的路径是错的）：

- ``POST /api/session/{id}/fork``，body ``{}``，复制投影历史 fork 出子会话，
  回 ``{"data": Session.Info}``；
- ``DELETE /api/session/{id}``，删掉用完的子会话；
- ``POST /api/session/{id}/prompt``，body ``{"text": ...}``，收工回 inbox 记录；
- ``POST /api/experimental/session/{id}/wait``，阻塞到该会话空闲，回 204；
- ``GET /api/session/{id}/message?order=desc&limit=200``，回 ``{"data": [...], "cursor": ...}``；
- Basic 认证：用户名 ``opencode``，口令现读自 ``opencode service get password``；
- 端口现读自 ``opencode service status`` 的最后一个非空行。

口令只在内存里待着：不落盘、不打印、不进任何仓库文件。
"""

from __future__ import annotations

import base64
import contextlib
import json
import subprocess
import time
import urllib.error
import urllib.request
from collections.abc import Callable, Mapping
from typing import Any

from dsb.config import parse_password, parse_service_endpoint
from dsb.opencode import extract_answer, has_assistant

AUTH_USERNAME = "opencode"
SERVICE_BIN = "opencode"
# 两段等待，两个预算（真机 #14：主对话在忙时，一个 140s 的共享预算被排队吃掉，
# 答复 212s 才出来，页面只等到了 opencode-timeout）。
# 排队看人：主对话在跑活时问题只能排队等着，这个时长不可控，给得宽。
DEFAULT_QUEUE_TIMEOUT = 600.0
# 答复看系统：一旦 assistant 消息出现，剩下这段就是它把答复写完的时间。
DEFAULT_ASK_TIMEOUT = 140.0
DEFAULT_POLL_INTERVAL = 0.5
DEFAULT_HTTP_TIMEOUT = 10.0
SERVICE_READ_TIMEOUT = 10.0
MESSAGE_PAGE_SIZE = 200
MESSAGE_QUERY = f"?order=desc&limit={MESSAGE_PAGE_SIZE}"

# 子 agent 的开场白。fork 出来的子会话**知道**自己是从一条真对话里分出去的，
# 实测这样它会答得像在跟人聊天——点评自己的会话 id、复述分析过程（真机：
# 问它「只回这一句」，回来的是一段环境解说）。这段框住它只答问题本身。
CHILD_ROLE = (
    "你在回答一个从 DeepSeek 网页转过来的问题。只回答下面这个问题本身："
    "不要描述你在哪个会话里，不要解释你的环境，不要写分析过程或复述问题。"
    "直接给答复正文。\n\n问题："
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


class OpencodeClient:
    """把问题送进 opencode 的已有会话，等它答完再把消息体折成 outcome 交出去。"""

    def __init__(
        self,
        session_id: str | None,
        *,
        service_reader: Callable[[], Mapping[str, Any]] = read_service,
        urlopen: Callable[..., Any] = urllib.request.urlopen,
        queue_timeout: float = DEFAULT_QUEUE_TIMEOUT,
        ask_timeout: float = DEFAULT_ASK_TIMEOUT,
        poll_interval: float = DEFAULT_POLL_INTERVAL,
        http_timeout: float = DEFAULT_HTTP_TIMEOUT,
        now: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
        wall_clock: Callable[[], float] = time.time,
    ) -> None:
        self._session_id = session_id
        self._service_reader = service_reader
        self._urlopen = urlopen
        self._queue_timeout = queue_timeout
        self._ask_timeout = ask_timeout
        self._poll_interval = poll_interval
        self._http_timeout = http_timeout
        self._now = now
        self._sleep = sleep
        self._wall_clock = wall_clock
        self._cached: Mapping[str, Any] | None = None

    def warm_up(self) -> bool:
        """启动时现读一次端口与口令；读不到返回 False，之后按请求重试。"""
        return self._service() is not None

    def ask(self, question: str) -> Mapping[str, Any]:
        """问一句 → outcome（``success`` 带消息体，其余是失败分支）。

        每问 fork 一个子会话去答，答完就删。主 agent 是**页面上的 DeepSeek 模型**
        ——它排一个围栏就是一次调用；本机这条主对话只作为上下文来源被继承，
        全程不排队、不阻塞、也不参与。
        """
        if not self._session_id:
            # 没有 sessionID：在线协议的错误码里没有专码，走非预期响应兜底。
            return {"kind": "unexpected"}
        service = self._service()
        if service is None:
            return {"kind": "not-running"}
        try:
            child_id = self._fork(service)
            try:
                baseline_ms = int(self._wall_clock() * 1000)
                self._call(
                    service,
                    "POST",
                    f"/api/session/{child_id}/prompt",
                    {"text": answer_prompt(question)},
                )
                return self._await_answer(service, child_id, baseline_ms)
            finally:
                # 子会话用完即弃：留着会在会话列表里堆一排 fork #N。
                self._dispose(service, child_id)
        except Exception as exc:  # 任何现场都折成可识别分支，不往外抛裸堆栈
            outcome = outcome_from_exception(exc)
            if outcome["kind"] == "not-running":
                self._cached = None  # 服务可能换了端口，下次请求现读
            return outcome

    def _fork(self, service: Mapping[str, Any]) -> str:
        """复制主对话的投影历史，fork 出一个子会话；返回它的 id。"""
        forked = self._call(service, "POST", f"/api/session/{self._session_id}/fork", {})
        child = forked.get("data") if isinstance(forked, Mapping) else None
        child_id = child.get("id") if isinstance(child, Mapping) else None
        if not isinstance(child_id, str) or not child_id:
            raise ServiceUnavailable("fork 出来的子会话没有 id")
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

    def _await_answer(
        self,
        service: Mapping[str, Any],
        session_id: str,
        baseline_ms: int,
    ) -> Mapping[str, Any]:
        """等到子会话空闲、且 baseline 之后确实有带正文的答复为止。

        两段预算：还没见到 assistant 消息时算「排队」（子会话刚起来、还没开工，
        这段可能较长），一旦见到 assistant 消息就换成「答复」预算重新计时。
        """
        queue_deadline = self._now() + self._queue_timeout
        answer_deadline: float | None = None
        session = f"/api/session/{session_id}"
        while True:
            deadline = answer_deadline if answer_deadline is not None else queue_deadline
            remaining = deadline - self._now()
            if remaining <= 0:
                return {"kind": "timeout"}
            # 阻塞到子会话空闲；如果它抢在 agent 循环启动前就返回，下面会因为拿不到
            # 答复正文而再转一圈，下一趟才是真的在等。
            self._call(
                service,
                "POST",
                f"/api/experimental/session/{session_id}/wait",
                timeout=remaining,
            )
            fresh = fresh_messages(
                self._call(service, "GET", f"{session}/message{MESSAGE_QUERY}"),
                baseline_ms,
            )
            if fresh is None:
                return {"kind": "unexpected"}
            if extract_answer(fresh) is not None:
                return {"kind": "success", "body": fresh}
            # 答复开写了就换预算：正文可能还空着，但已经在写了。
            if answer_deadline is None and has_assistant(fresh):
                answer_deadline = self._now() + self._ask_timeout
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
