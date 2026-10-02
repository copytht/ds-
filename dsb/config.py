"""sessionID 与开关的解析纯函数（现读不落盘，不发任何请求）。

- sessionID：``.env`` 文本（spec #9：扩展侧因此不需要任何输入面）；
- 动作开关与 token 的落点。

**不再读 opencode 后台服务的端口与口令**：子会话换成本机宿主（ADR-0009）后没有
后台服务可连，中继直接起 ``opencode run``，没有端口、没有 Basic 认证。
"""

from __future__ import annotations

from pathlib import Path

SESSION_ID_ENV_KEY = "OPENSESS_ID"

#: 动作写端点的 token 落点：固定路径、0600、不进版本库（调用方从这儿读，agent 不手工管）。
ACTION_TOKEN_PATH = Path(__file__).resolve().parents[1] / ".dsb-token"


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
