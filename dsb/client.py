"""opencode 后台服务的 HTTP 调用：中继里唯一发外部请求的模块。

现场一律先折成 :mod:`dsb.opencode` 认的 outcome 分支，回灌载荷由
``payload_from_outcome`` 负责；这里不产出任何编码后的文本（TOON 归扩展）。

opencode API 以本机实测为准（v2.0.18，实测早于文档与官方 SDK，SDK 的路径是错的）：

- ``POST /api/session/{id}/prompt``，body ``{"text": ...}``，收工回 inbox 记录；
- ``POST /api/experimental/session/{id}/wait``，阻塞到该会话空闲，回 204；
- ``GET /api/session/{id}/message?order=desc&limit=200``，回 ``{"data": [...], "cursor": ...}``；
- Basic 认证：用户名 ``opencode``，口令现读自 ``opencode service get password``；
- 端口现读自 ``opencode service status`` 的最后一个非空行。

口令只在内存里待着：不落盘、不打印、不进任何仓库文件。
"""

from __future__ import annotations

import base64
import json
import subprocess
import time
import urllib.error
import urllib.request
from collections.abc import Callable, Mapping
from typing import Any

from dsb.config import parse_password, parse_service_endpoint
from dsb.opencode import extract_answer

AUTH_USERNAME = "opencode"
SERVICE_BIN = "opencode"
DEFAULT_ASK_TIMEOUT = 140.0
DEFAULT_POLL_INTERVAL = 0.5
DEFAULT_HTTP_TIMEOUT = 10.0
SERVICE_READ_TIMEOUT = 10.0
MESSAGE_PAGE_SIZE = 200
MESSAGE_QUERY = f"?order=desc&limit={MESSAGE_PAGE_SIZE}"


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
        """问一句 → outcome（``success`` 带消息体，其余是失败分支）。"""
        if not self._session_id:
            # 没有 sessionID：在线协议的错误码里没有专码，走非预期响应兜底。
            return {"kind": "unexpected"}
        service = self._service()
        if service is None:
            return {"kind": "not-running"}
        baseline_ms = int(self._wall_clock() * 1000)
        try:
            self._call(
                service,
                "POST",
                f"/api/session/{self._session_id}/prompt",
                {"text": question},
            )
            return self._await_answer(service, baseline_ms)
        except Exception as exc:  # 任何现场都折成可识别分支，不往外抛裸堆栈
            outcome = outcome_from_exception(exc)
            if outcome["kind"] == "not-running":
                self._cached = None  # 服务可能换了端口，下次请求现读
            return outcome

    def _service(self) -> Mapping[str, Any] | None:
        if self._cached is None:
            try:
                self._cached = self._service_reader()
            except Exception:  # 现读失败一律当「服务没跑」，由调用方回错误码
                return None
        return self._cached

    def _await_answer(self, service: Mapping[str, Any], baseline_ms: int) -> Mapping[str, Any]:
        """等到会话空闲、且 baseline 之后确实有带正文的答复为止。"""
        deadline = self._now() + self._ask_timeout
        session = f"/api/session/{self._session_id}"
        while True:
            remaining = deadline - self._now()
            if remaining <= 0:
                return {"kind": "timeout"}
            # 阻塞到会话空闲；如果它抢在 agent 循环启动前就返回，下面会因为拿不到
            # 答复正文而再转一圈，下一趟才是真的在等。
            self._call(
                service,
                "POST",
                f"/api/experimental/session/{self._session_id}/wait",
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
