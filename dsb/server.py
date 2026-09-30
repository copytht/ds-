"""`uv run ds-mcp` 起的本机 HTTP 中继（ADR-0001：中继，不是 MCP 服务）。

端点（扩展侧只打这三条）：

- ``GET  /health`` → ``{"status": "ok", "opencode": "up" | "down"}``：中继在不在、
  opencode 在不在（两件事出事时长得一样，分开了才知道该重启哪个）；
- ``GET  /status`` → ``{"status": "ok", "ask": null | {"phase", "written", "remaining"}}``
  ：现在有没有问句在途，在途的话走到哪一步——等待期的现场，只读；
- ``POST /ask``    body ``{"question": "..."}`` → ``{"status": "ok", "answer": ...}``
  或 ``{"status": "error", "error": ...}``（错误码只在 #10 fixture 的册子上）。

成功与失败同构、都回 200（只有请求本身不合线协议才回 4xx），解析只有一条路径；
编码（TOON）不在这边，Python 侧不引任何 TOON 库。

失败与慢另外留痕（:mod:`dsb.log`）：事件名固定、字段有名有姓，**问题正文进不来**
——签名里就没有那个位置。访问日志照旧整个关掉。
"""

from __future__ import annotations

import json
import os
import sys
import time
from collections.abc import Callable, Mapping
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from dsb.client import DEFAULT_ANSWER_TIMEOUT, DEFAULT_START_TIMEOUT, OpencodeClient
from dsb.config import parse_session_id
from dsb.log import SLOW_MS, log_event, setup_logging
from dsb.opencode import ERROR_UNEXPECTED, error_payload, payload_from_outcome

HEALTH_PATH = "/health"
STATUS_PATH = "/status"
ASK_PATH = "/ask"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8787
PORT_ENV_KEY = "DSB_PORT"
ANSWER_TIMEOUT_ENV_KEY = "DSB_ANSWER_TIMEOUT"
START_TIMEOUT_ENV_KEY = "DSB_START_TIMEOUT"
MAX_BODY_BYTES = 64 * 1024

AskFn = Callable[[str], Mapping[str, Any]]
ProbeFn = Callable[[], str]
StatusFn = Callable[[], Mapping[str, Any]]
Payload = dict[str, Any]

#: 哪条路炸了就叫哪个名字：探活炸了和问句炸了，排查方向完全两样。
BROKE_EVENT: dict[str, str] = {
    "/ask": "ask-broke",
    "/health": "probe-broke",
    "/status": "status-broke",
}


def parse_question(body: bytes) -> str | None:
    """请求体 → 问题正文；不合 ``{"question": "..."}`` 的一律 None。"""
    try:
        data = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None
    if not isinstance(data, Mapping):
        return None
    question = data.get("question")
    if not isinstance(question, str) or not question.strip():
        return None
    return question


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
) -> tuple[int, Payload]:
    """一次请求 → (HTTP 状态码, 载荷)；纯接缝，不碰 socket。

    ``probe`` 与 ``status`` 是可选的旁路：接上就多报一项，没接上回最素的载荷，
    好让「路由怎么分发」能被单独断言，不必先架起一整套 opencode 替身。
    """
    path = urlsplit(path).path
    if method == "GET" and path == HEALTH_PATH:
        return 200, health_payload(probe() if probe is not None else None)
    if method == "GET" and path == STATUS_PATH:
        if status is None:
            return 200, {"status": "ok", "ask": None}
        return 200, dict(status())
    if method == "POST" and path == ASK_PATH:
        question = parse_question(body)
        if question is None:
            # 请求本身不合线协议：错误码只在册的三个，这里落非预期响应兜底。
            return 400, error_payload(ERROR_UNEXPECTED)
        # 不在这儿接异常：route 是纯接缝，谁出岔子谁留痕——接住就等于把现场销毁了。
        return 200, payload_from_outcome(ask(question))
    if method in {"GET", "POST"}:
        return 404, error_payload(ERROR_UNEXPECTED)
    return 405, error_payload(ERROR_UNEXPECTED)


def make_handler(
    ask: AskFn, probe: ProbeFn | None = None, status: StatusFn | None = None
) -> type[BaseHTTPRequestHandler]:
    """造请求处理类（每次请求一个实例；socket 细节只在这层）。"""

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
            started = time.monotonic()
            try:
                status_code, payload = route(method, self.path, self._body(), ask, probe, status)
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
            self._send(status_code, payload)

        def _record(self, path: str, status: int, payload: Payload | None, took_ms: float) -> None:
            """只记**失败与慢**：成功且快的探活每 30s 一条，只会把日志淹掉。"""
            if status >= 400:
                log_event("bad-request", path=path, http=status, took_ms=took_ms)
                return
            if path == ASK_PATH:
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

        def _send(self, status: int, payload: Payload | None) -> None:
            data = (
                b"" if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
            )
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
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
) -> ThreadingHTTPServer:
    """起中继的 HTTP 服务（测试用 port=0 拿随机端口）。"""
    server = ThreadingHTTPServer((host, port), make_handler(ask, probe, status))
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


def resolve_answer_timeout(env_text: str) -> float:
    """答复写完的超时秒数：进程环境变量优先，其次 `.env` 里的 DSB_ANSWER_TIMEOUT。"""
    return resolve_seconds(env_text, ANSWER_TIMEOUT_ENV_KEY, DEFAULT_ANSWER_TIMEOUT)


def resolve_start_timeout(env_text: str) -> float:
    """模型开工的超时秒数：进程环境变量优先，其次 `.env` 里的 DSB_START_TIMEOUT。"""
    return resolve_seconds(env_text, START_TIMEOUT_ENV_KEY, DEFAULT_START_TIMEOUT)


def main() -> None:
    """`uv run ds-mcp` 的入口：现读端口/口令/sessionID，然后对外服务。"""
    setup_logging()
    env_text = read_env_text()
    session_id = parse_session_id(env_text)
    port = resolve_port(env_text)
    client = OpencodeClient(
        session_id,
        start_timeout=resolve_start_timeout(env_text),
        answer_timeout=resolve_answer_timeout(env_text),
    )
    warm = client.warm_up()  # 启动现读：端口与口令只进内存
    print(
        f"[dsb] 中继已启动：http://{DEFAULT_HOST}:{port}"
        f"（{ASK_PATH} / {STATUS_PATH} / {HEALTH_PATH}）",
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
    with make_server(client.ask, port=port, probe=client.probe, status=client.status) as server:
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\n[dsb] 已停止")


if __name__ == "__main__":
    main()
