"""端口、口令与 sessionID 的解析纯函数（现读不落盘，不发任何请求）。

- 端口与口令：``opencode service status`` / ``opencode service get password`` 的输出（ADR-0001）；
- sessionID：``.env`` 文本（spec #9：扩展侧因此不需要任何输入面）。
"""

from __future__ import annotations

from urllib.parse import urlparse

SESSION_ID_ENV_KEY = "OPENSESS_ID"


def parse_service_endpoint(status_output: str) -> dict[str, str | int]:
    """``opencode service status`` 输出 → ``{"host": ..., "port": ...}``。"""
    lines = [line.strip() for line in status_output.splitlines() if line.strip()]
    if not lines:
        raise ValueError("opencode service status 没有输出")

    parsed = urlparse(lines[-1])
    if parsed.scheme not in {"http", "https"} or parsed.hostname is None:
        raise ValueError(f"认不出 opencode 服务地址：{lines[-1]}")
    if parsed.port is None:
        raise ValueError(f"opencode 服务地址里没有端口：{lines[-1]}")
    return {"host": parsed.hostname, "port": parsed.port}


def parse_password(password_output: str) -> str:
    """``opencode service get password`` 输出 → 口令本身。"""
    lines = [line.strip() for line in password_output.splitlines() if line.strip()]
    if not lines:
        raise ValueError("opencode service get password 没有输出")
    return lines[0]


def parse_session_id(env_text: str, key: str = SESSION_ID_ENV_KEY) -> str | None:
    """``.env`` 文本 → sessionID；注释与别的变量一律忽略，缺键返回 None。"""
    for line in env_text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        name, separator, value = stripped.partition("=")
        if not separator or name.strip() != key:
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        return value or None
    return None
