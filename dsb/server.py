"""`uv run ds-mcp` 起的本机 HTTP 中继（ADR-0001：中继，不是 MCP 服务）。

端点（扩展侧只打这两条）：

- ``GET  /health`` → ``{"status": "ok"}``：中继在不在；
- ``POST /ask``    body ``{"question": "..."}`` → ``{"status": "ok", "answer": ...}``
  或 ``{"status": "error", "error": ...}``（错误码只在 #10 fixture 的册子上）。

成功与失败同构、都回 200（只有请求本身不合线协议才回 4xx），解析只有一条路径；
编码（TOON）不在这边，Python 侧不引任何 TOON 库。
"""

from __future__ import annotations

import json
import os
import sys
from collections.abc import Callable, Mapping
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from dsb.client import DEFAULT_ASK_TIMEOUT, DEFAULT_QUEUE_TIMEOUT, OpencodeClient
from dsb.config import parse_session_id
from dsb.opencode import ERROR_UNEXPECTED, error_payload, payload_from_outcome

HEALTH_PATH = "/health"
ASK_PATH = "/ask"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8787
PORT_ENV_KEY = "DSB_PORT"
ASK_TIMEOUT_ENV_KEY = "DSB_ASK_TIMEOUT"
QUEUE_TIMEOUT_ENV_KEY = "DSB_QUEUE_TIMEOUT"
MAX_BODY_BYTES = 64 * 1024

AskFn = Callable[[str], Mapping[str, Any]]
Payload = dict[str, Any]


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


def route(method: str, path: str, body: bytes, ask: AskFn) -> tuple[int, Payload]:
    """一次请求 → (HTTP 状态码, 载荷)；纯接缝，不碰 socket。"""
    path = urlsplit(path).path
    if method == "GET" and path == HEALTH_PATH:
        return 200, {"status": "ok"}
    if method == "POST" and path == ASK_PATH:
        question = parse_question(body)
        if question is None:
            # 请求本身不合线协议：错误码只在册的三个，这里落非预期响应兜底。
            return 400, error_payload(ERROR_UNEXPECTED)
        try:
            return 200, payload_from_outcome(ask(question))
        except Exception:  # 中继自己出岔子也不回裸堆栈
            return 500, error_payload(ERROR_UNEXPECTED)
    if method in {"GET", "POST"}:
        return 404, error_payload(ERROR_UNEXPECTED)
    return 405, error_payload(ERROR_UNEXPECTED)


def make_handler(ask: AskFn) -> type[BaseHTTPRequestHandler]:
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
            status, payload = route(method, self.path, self._body(), ask)
            self._send(status, payload)

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
    ask: AskFn, host: str = DEFAULT_HOST, port: int = DEFAULT_PORT
) -> ThreadingHTTPServer:
    """起中继的 HTTP 服务（测试用 port=0 拿随机端口）。"""
    server = ThreadingHTTPServer((host, port), make_handler(ask))
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


def resolve_ask_timeout(env_text: str) -> float:
    """等答复的超时秒数：进程环境变量优先，其次 `.env` 里的 DSB_ASK_TIMEOUT。"""
    return resolve_seconds(env_text, ASK_TIMEOUT_ENV_KEY, DEFAULT_ASK_TIMEOUT)


def resolve_queue_timeout(env_text: str) -> float:
    """等主对话空出来的秒数：进程环境变量优先，其次 `.env` 里的 DSB_QUEUE_TIMEOUT。"""
    return resolve_seconds(env_text, QUEUE_TIMEOUT_ENV_KEY, DEFAULT_QUEUE_TIMEOUT)


def main() -> None:
    """`uv run ds-mcp` 的入口：现读端口/口令/sessionID，然后对外服务。"""
    env_text = read_env_text()
    session_id = parse_session_id(env_text)
    port = resolve_port(env_text)
    client = OpencodeClient(
        session_id,
        queue_timeout=resolve_queue_timeout(env_text),
        ask_timeout=resolve_ask_timeout(env_text),
    )
    warm = client.warm_up()  # 启动现读：端口与口令只进内存
    print(
        f"[dsb] 中继已启动：http://{DEFAULT_HOST}:{port}（{ASK_PATH} / {HEALTH_PATH}）",
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
    with make_server(client.ask, port=port) as server:
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\n[dsb] 已停止")


if __name__ == "__main__":
    main()
