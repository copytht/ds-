"""`uv run ds-mcp` 起的本机 HTTP 中继（ADR-0001：中继，不是 MCP 服务）。

端点（扩展侧只打这三条）：

- ``GET  /health`` → ``{"status": "ok", "opencode": "up" | "down"}``：中继在不在、
  opencode 在不在（两件事出事时长得一样，分开了才知道该重启哪个）；
- ``GET  /status`` → ``{"status": "ok", "ask": null | {"phase", "written", "remaining"}}``
  ：现在有没有问句在途，在途的话走到哪一步——等待期的现场，只读；
- ``POST /ask``    body ``{"question": "..."}`` → ``{"status": "ok", "answer": ...}``
  或 ``{"status": "error", "error": ...}``（错误码只在 #10 fixture 的册子上）。

动作服务（ADR-0007，实现在 :mod:`dsb.actions`）另加三条：

- ``POST /action``      写端点，验 Bearer token，阻塞到扩展回传
  （``{"ok", "action", "result"|"error"}``）；
- ``GET  /actions``     动作流（SSE），扩展订它收动作；这条不走 :func:`route`，要写流；
- ``POST /action/result`` 扩展回传结果，不验 token（读侧靠不下发 CORS 头兜）。

成功与失败同构、都回 200（只有请求本身不合线协议才回 4xx），解析只有一条路径；
编码（TOON）不在这边，Python 侧不引任何 TOON 库。

失败与慢另外留痕（:mod:`dsb.log`）：事件名固定、字段有名有姓，**问题正文进不来**
——签名里就没有那个位置。访问日志照旧整个关掉。
"""

from __future__ import annotations

import json
import os
import signal
import sys
import time
from collections.abc import Callable, Mapping
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from dsb.actions import (
    ACTION_PATH,
    ACTION_RESULT_PATH,
    ACTIONS_PATH,
    ActionServer,
    ensure_token,
    resolve_enabled,
)
from dsb.asks import AskSessions
from dsb.client import DEFAULT_IDLE_TIMEOUT, OpencodeClient
from dsb.config import parse_session_id
from dsb.log import SLOW_MS, log_event, setup_logging
from dsb.opencode import ERROR_UNEXPECTED, error_payload, payload_from_outcome
from dsb.said import SAID_PATH, SaidLog

HEALTH_PATH = "/health"
STATUS_PATH = "/status"
ASK_PATH = "/ask"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8787
PORT_ENV_KEY = "DSB_PORT"
IDLE_TIMEOUT_ENV_KEY = "DSB_IDLE_TIMEOUT"
MAX_BODY_BYTES = 64 * 1024

AskFn = Callable[[str, str | None], Mapping[str, Any]]
ProbeFn = Callable[[], str]
StatusFn = Callable[[], Mapping[str, Any]]
Payload = dict[str, Any]
#: 动作请求 → (状态码, 载荷)：鉴权与失败码都在 dsb.actions 那头，这边只当接缝递进去。
ActionFn = Callable[[bytes, str | None], tuple[int, Payload]]
#: 扩展回传 → (状态码, 载荷)。
ActionResultFn = Callable[[bytes], tuple[int, Payload]]
#: 不下发 CORS 头的端点（ADR-0007 读侧）：网页的跨源读必须撞死，扩展与本机进程天然放行。
NO_CORS_PATHS = frozenset({ACTIONS_PATH, ACTION_RESULT_PATH, SAID_PATH})

#: 哪条路炸了就叫哪个名字：探活炸了和问句炸了，排查方向完全两样。
BROKE_EVENT: dict[str, str] = {
    "/ask": "ask-broke",
    "/health": "probe-broke",
    "/status": "status-broke",
    "/action": "action-broke",
    "/action/result": "action-result-broke",
}


def parse_ask_request(body: bytes) -> tuple[str, str | None] | None:
    """请求体 → ``(问题, id)``；``id`` 可选（扩展短轮询带它，curl 不带）。

    不合 ``{"question": "...", "id"?: "..."}`` 的一律 None。带 id 是为了让一趟长问句能被
    拆成几趟短轮询（长 fetch 会被浏览器收走，见 :mod:`dsb.asks`）。
    """
    try:
        data = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None
    if not isinstance(data, Mapping):
        return None
    question = data.get("question")
    if not isinstance(question, str) or not question.strip():
        return None
    session_id = data.get("id")
    if session_id is not None and (not isinstance(session_id, str) or not session_id.strip()):
        return None
    return question, session_id


def parse_question(body: bytes) -> str | None:
    """请求体 → 问题正文；只看问题那一条（老接缝，校验与测试用）。"""
    parsed = parse_ask_request(body)
    return None if parsed is None else parsed[0]


def health_payload(opencode: str | None) -> Payload:
    """``/health`` 的载荷：中继恒在（能答就是活的），顺带报 opencode 的死活。

    ``probe`` 没接上时就不带 ``opencode`` 字段——不知道就别瞎报一个出去。
    """
    payload: Payload = {"status": "ok"}
    if opencode is not None:
        payload["opencode"] = opencode
    return payload


def route(
    method: str,
    path: str,
    body: bytes,
    ask: AskFn,
    probe: ProbeFn | None = None,
    status: StatusFn | None = None,
    action: ActionFn | None = None,
    action_result: ActionResultFn | None = None,
    said: SaidLog | None = None,
    authorization: str | None = None,
) -> tuple[int, Payload]:
    """一次请求 → (HTTP 状态码, 载荷)；纯接缝，不碰 socket。

    ``probe`` 与 ``status`` 是可选的旁路：接上就多报一项，没接上回最素的载荷，
    好让「路由怎么分发」能被单独断言，不必先架起一整套 opencode 替身。
    ``action`` / ``action_result`` 同理，是动作服务的两条旁路（``GET /actions`` 不在这儿：
    它要写 SSE 流，由 RelayHandler 单独接，见 :meth:`RelayHandler._stream_actions`）。
    """
    path = urlsplit(path).path
    if method == "GET" and path == HEALTH_PATH:
        return 200, health_payload(probe() if probe is not None else None)
    if method == "GET" and path == STATUS_PATH:
        if status is None:
            return 200, {"status": "ok", "ask": None}
        return 200, dict(status())
    if method == "POST" and path == ASK_PATH:
        parsed = parse_ask_request(body)
        if parsed is None:
            # 请求本身不合线协议：错误码只在册的三个，这里落非预期响应兜底。
            return 400, error_payload(ERROR_UNEXPECTED)
        question, session_id = parsed
        # 不在这儿接异常：route 是纯接缝，谁出岔子谁留痕——接住就等于把现场销毁了。
        return 200, payload_from_outcome(ask(question, session_id))
    if method == "POST" and path == ACTION_PATH:
        if action is None:
            return 404, error_payload(ERROR_UNEXPECTED)
        return action(body, authorization)
    if method == "POST" and path == ACTION_RESULT_PATH:
        if action_result is None:
            return 404, error_payload(ERROR_UNEXPECTED)
        return action_result(body)
    if path == SAID_PATH and method in {"GET", "POST"}:
        if said is None:
            return 404, error_payload(ERROR_UNEXPECTED)
        return said.read() if method == "GET" else said.add(body)
    if method in {"GET", "POST"}:
        return 404, error_payload(ERROR_UNEXPECTED)
    return 405, error_payload(ERROR_UNEXPECTED)


def make_handler(
    ask: AskFn,
    probe: ProbeFn | None = None,
    status: StatusFn | None = None,
    actions: ActionServer | None = None,
    said: SaidLog | None = None,
) -> type[BaseHTTPRequestHandler]:
    """造请求处理类（每次请求一个实例；socket 细节只在这层）。"""

    action: ActionFn | None = actions.submit if actions is not None else None
    action_result: ActionResultFn | None = actions.record_result if actions is not None else None

    class RelayHandler(BaseHTTPRequestHandler):
        server_version = "dsb"
        protocol_version = "HTTP/1.1"

        def do_GET(self) -> None:
            self._respond("GET")

        def do_POST(self) -> None:
            self._respond("POST")

        def do_OPTIONS(self) -> None:  # 扩展来的跨域预检
            self._send(204, None)

        def do_PUT(self) -> None:
            self._respond("PUT")

        def do_DELETE(self) -> None:
            self._respond("DELETE")

        def _respond(self, method: str) -> None:
            path = urlsplit(self.path).path
            if method == "GET" and path == ACTIONS_PATH:
                # 动作流不走 route：它得按行往 socket 上写，塞进 (状态码, 载荷) 就假了。
                if actions is None:
                    self._send(404, error_payload(ERROR_UNEXPECTED))
                    return
                self._stream_actions(actions)
                return
            started = time.monotonic()
            try:
                status_code, payload = route(
                    method,
                    self.path,
                    self._body(),
                    ask,
                    probe,
                    status,
                    action=action,
                    action_result=action_result,
                    said=said,
                    authorization=self.headers.get("Authorization"),
                )
            except Exception as exc:  # route 该兜的都兜了：漏到这儿的是探活 / 别的旁路
                took_ms = (time.monotonic() - started) * 1000
                # 接住而不是放着断连：裸断连对扩展来说长得像「中继死了」，日志里却一个字没有。
                log_event(
                    BROKE_EVENT.get(path, "request-broke"),
                    path=path,
                    exc=exc,
                    took_ms=took_ms,
                )
                self._send(500, error_payload(ERROR_UNEXPECTED))
                return
            self._record(path, status_code, payload, (time.monotonic() - started) * 1000)
            self._send(status_code, payload, cors=path not in NO_CORS_PATHS)

        def _stream_actions(self, actions: ActionServer) -> None:
            """``GET /actions``：SSE 下发（ADR-0007）。

            ``ThreadingHTTPServer`` 没有流式响应这一说，自己写头、自己按行刷；
            **不下发 CORS 头**——网页的 EventSource 是简单请求、不预检，拿不到头就读不走。
            扩展断开是常态（标签页关了 / MV3 收摊），收摊就好，不算故障。
            """
            subscriber = actions.subscribe(self.connection)
            try:
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Cache-Control", "no-cache")
                self.send_header("Connection", "keep-alive")
                self.end_headers()
                for chunk in actions.frames(subscriber):
                    self.wfile.write(chunk)
                    self.wfile.flush()
            except OSError:
                pass  # 对端把连接收走了：动作流本来就是条挂着的连接
            finally:
                actions.unsubscribe(subscriber)
                self.close_connection = True

        def _record(self, path: str, status: int, payload: Payload | None, took_ms: float) -> None:
            """只记**失败与慢**：成功且快的探活每 30s 一条，只会把日志淹掉。"""
            if status >= 400:
                log_event("bad-request", path=path, http=status, took_ms=took_ms)
                return
            if path == ASK_PATH:
                if isinstance(payload, Mapping) and payload.get("status") == "pending":
                    return  # 一趟没等到（长问句的正常中间态）：不是失败，不记
                error = payload.get("error") if isinstance(payload, Mapping) else None
                if isinstance(payload, Mapping) and payload.get("status") == "error":
                    log_event(
                        "ask-fail",
                        error=error if isinstance(error, str) else None,
                        took_ms=took_ms,
                    )
                else:
                    answer = payload.get("answer") if isinstance(payload, Mapping) else None
                    log_event(
                        "ask-ok",
                        took_ms=took_ms,
                        answer_chars=len(answer) if isinstance(answer, str) else 0,
                    )
                return
            # 探活与现场轮询慢了，就是扩展翻红的前兆——它们各有 5s 的预算。
            if path in (HEALTH_PATH, STATUS_PATH) and took_ms >= SLOW_MS:
                log_event("slow", path=path, took_ms=took_ms)

        def _body(self) -> bytes:
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0:
                return b""
            if length > MAX_BODY_BYTES:
                self.close_connection = True  # 不读剩下的字节，直接断开，免得连接错位
                return b""
            return self.rfile.read(length)

        def _send(self, status: int, payload: Payload | None, *, cors: bool = True) -> None:
            data = (
                b"" if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
            )
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            if cors:
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                self.send_header("Access-Control-Allow-Headers", "content-type")
            self.end_headers()
            if data:
                self.wfile.write(data)

        def log_message(self, format: str, *args: Any) -> None:
            pass  # 问题正文不进日志

    return RelayHandler


def make_server(
    ask: AskFn,
    host: str = DEFAULT_HOST,
    port: int = DEFAULT_PORT,
    probe: ProbeFn | None = None,
    status: StatusFn | None = None,
    actions: ActionServer | None = None,
    said: SaidLog | None = None,
) -> ThreadingHTTPServer:
    """起中继的 HTTP 服务（测试用 port=0 拿随机端口）。"""
    server = ThreadingHTTPServer((host, port), make_handler(ask, probe, status, actions, said))
    server.daemon_threads = True
    return server


def env_path() -> Path | None:
    """`.env` 的落点：先看当前目录，再看包所在仓库根。"""
    for candidate in (Path.cwd() / ".env", Path(__file__).resolve().parents[1] / ".env"):
        if candidate.is_file():
            return candidate
    return None


def read_env_text() -> str:
    path = env_path()
    return path.read_text(encoding="utf-8") if path is not None else ""


def resolve_port(env_text: str) -> int:
    """监听端口：进程环境变量优先，其次 `.env` 里的 DSB_PORT，最后默认值。"""
    raw = os.environ.get(PORT_ENV_KEY) or parse_session_id(env_text, PORT_ENV_KEY)
    if raw is None:
        return DEFAULT_PORT
    try:
        port = int(raw)
    except ValueError:
        print(f"[dsb] {PORT_ENV_KEY}={raw!r} 不是端口号，改用默认 {DEFAULT_PORT}", file=sys.stderr)
        return DEFAULT_PORT
    if not 0 < port < 65536:
        print(f"[dsb] {PORT_ENV_KEY}={port} 越界，改用默认 {DEFAULT_PORT}", file=sys.stderr)
        return DEFAULT_PORT
    return port


def resolve_seconds(env_text: str, key: str, default: float) -> float:
    """一段等待的秒数：进程环境变量优先，其次 `.env` 里的同名键，最后默认值。"""
    raw = os.environ.get(key) or parse_session_id(env_text, key)
    if raw is None:
        return default
    try:
        seconds = float(raw)
    except ValueError:
        seconds = 0.0
    if seconds <= 0:
        print(f"[dsb] {key}={raw!r} 不是正秒数，改用默认 {default}", file=sys.stderr)
        return default
    return seconds


def resolve_idle_timeout(env_text: str) -> float:
    """静默多少秒算超时：进程环境变量优先，其次 `.env` 里的 DSB_IDLE_TIMEOUT。

    opencode 在这个窗口里只要还有动静（事件 / 新消息 / 正文在长）就一直往下等。
    """
    return resolve_seconds(env_text, IDLE_TIMEOUT_ENV_KEY, DEFAULT_IDLE_TIMEOUT)


def main() -> None:
    """`uv run ds-mcp` 的入口：现读端口/口令/sessionID，然后对外服务。"""
    setup_logging()
    # pkill / 系统收摊发的是 SIGTERM，Python 默认直接退出、finally 不跑，那个一直复用的
    # 子会话就成了没人删的孤儿（会话列表里每杀一次留一条）。让它走跟 Ctrl-C 同一条路。
    signal.signal(signal.SIGTERM, lambda *_args: sys.exit(0))
    env_text = read_env_text()
    session_id = parse_session_id(env_text)
    port = resolve_port(env_text)
    client = OpencodeClient(
        session_id,
        idle_timeout=resolve_idle_timeout(env_text),
    )
    ask = AskSessions(client.ask)  # 长问句拆成几趟短轮询，别让浏览器把后台线程连同答复一起收走
    warm = client.warm_up()  # 启动现读：端口与口令只进内存
    # 动作服务：token 启动现生成/复用（0600，固定路径），开关现读（DSB_ACTIONS_ENABLED）。
    actions = ActionServer(ensure_token(), enabled=resolve_enabled(env_text))
    said = SaidLog()
    print(
        f"[dsb] 中继已启动：http://{DEFAULT_HOST}:{port}"
        f"（{ASK_PATH} / {STATUS_PATH} / {HEALTH_PATH} / {ACTION_PATH} / {ACTIONS_PATH}）",
        flush=True,
    )
    if session_id is None:
        print(
            "[dsb] 缺 sessionID：在 .env 里补一行 OPENSESS_ID=<会话 id>，否则每次问都回错误。",
            file=sys.stderr,
        )
    if not warm:
        print(
            "[dsb] opencode 后台服务现读失败，按请求重试（没起就回 opencode-not-running）。",
            file=sys.stderr,
        )
    with make_server(
        ask.ask, port=port, probe=client.probe, status=client.status, actions=actions, said=said
    ) as server:
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\n[dsb] 已停止")
        finally:
            client.dispose()  # 活期间一直复用的子会话，收摊时删掉


if __name__ == "__main__":
    main()
