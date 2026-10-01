"""网页说给人听的话：**没排围栏**的那些 assistant 消息。

扩展在读完一条出站响应、认定里面没有 ``say`` 围栏时，把这段正文报上来；协调者（与用户
会话的 agent）来取。这样网页想说给人的话不再无声无息地挂在页面上等人凑巧看到。

读侧照 ADR-0007 的分头认：**不下发 CORS、不验 token**——网页的跨源请求被浏览器挡死，
扩展（有 host 权限）与本机进程天然放行。只留最近 :data:`SAID_LIMIT` 条。
"""

from __future__ import annotations

import json
import time
from collections import deque
from collections.abc import Mapping
from typing import Any

SAID_PATH = "/said"
SAID_LIMIT = 50


def parse_said(body: bytes) -> str | None:
    """请求体 → 正文；不合 ``{"text": "..."}`` 的一律 None。"""
    try:
        data = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None
    if not isinstance(data, Mapping):
        return None
    text = data.get("text")
    if not isinstance(text, str) or not text.strip():
        return None
    return text


class SaidLog:
    """最近几条「说给人的话」，有界；线程安全交给 GIL 与 deque 的原子 append。"""

    def __init__(self, limit: int = SAID_LIMIT) -> None:
        self._items: deque[dict[str, Any]] = deque(maxlen=limit)

    def add(self, body: bytes) -> tuple[int, dict[str, Any]]:
        text = parse_said(body)
        if text is None:
            return 400, {"status": "error", "error": "unexpected-response"}
        self._items.append({"text": text, "at": time.time()})
        return 200, {"status": "ok"}

    def read(self) -> tuple[int, dict[str, Any]]:
        return 200, {"status": "ok", "said": list(self._items)}
