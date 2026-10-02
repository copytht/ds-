"""opencode 的结果 → 回灌载荷的映射（纯函数，不发任何请求）。

中继只产出结构化 dict，TOON 编码归扩展（spec #9：Python 侧不引任何 TOON 库）。
HTTP 层（#11）把现场折成这里认的 outcome 分支：

- ``success`` + 响应体：正常答复，正文是一句字符串（宿主回的），或旧链路的消息列表；
- ``not-running``：子会话宿主没起来（进程没起、起崩了、或回应里 ``ok:false``）；
- ``timeout``：这一轮到点被掐；
- ``unexpected``：宿主答了，但答案不成样（空、或停在异常上）。
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypedDict

ERROR_NOT_RUNNING = "opencode-not-running"
ERROR_TIMEOUT = "opencode-timeout"
ERROR_UNEXPECTED = "unexpected-response"


class OkPayload(TypedDict):
    status: Literal["ok"]
    answer: str


class ErrorPayload(TypedDict):
    status: Literal["error"]
    error: str


class PendingPayload(TypedDict):
    """一次短轮询还没等到结果时的载荷：扩展拿它知道「中继还在干，接着问」。"""

    status: Literal["pending"]
    id: str


ReplyPayload = OkPayload | ErrorPayload
#: ``/send`` 的三种回法：成功 / 失败 / 还没出结果（带 id，接着轮询）。
SendPayload = ReplyPayload | PendingPayload


def ok_payload(answer: str) -> OkPayload:
    """status: ok + answer。"""
    return {"status": "ok", "answer": answer}


def error_payload(code: str) -> ErrorPayload:
    """status: error + error（可识别的错误码，扩展据此出失败提示）。"""
    return {"status": "error", "error": code}


def pending_payload(session_id: str) -> PendingPayload:
    """status: pending + id：这一趟轮询没等到，拿同一个 id 再问。"""
    return {"status": "pending", "id": session_id}


def _text_parts(message: Mapping[str, Any]) -> list[str]:
    parts = message.get("parts")
    if not isinstance(parts, list):
        return []
    texts: list[str] = []
    for part in parts:
        if isinstance(part, Mapping) and part.get("type") == "text":
            text = part.get("text")
            if isinstance(text, str):
                texts.append(text)
    return texts


def extract_answer(body: Any) -> str | None:
    """答复正文。两种形状都认：宿主回的一句纯文本，或 opencode 的消息列表（旧链路）。"""
    if isinstance(body, str):
        return body if body.strip() else None
    if isinstance(body, list):
        messages = [
            message
            for message in body
            if isinstance(message, Mapping) and message.get("role") == "assistant"
        ]
        if not messages:
            return None
        message = messages[-1]
    elif isinstance(body, Mapping):
        message = body
    else:
        return None

    text = "\n".join(_text_parts(message))
    return text if text.strip() else None


def payload_from_outcome(outcome: Mapping[str, Any] | Any) -> SendPayload:
    """把 outcome 分支映射成回灌载荷；认不出的一律算非预期响应。"""
    if not isinstance(outcome, Mapping):
        return error_payload(ERROR_UNEXPECTED)

    kind = outcome.get("kind")
    if kind == "success":
        answer = extract_answer(outcome.get("body"))
        if answer is None:
            return error_payload(ERROR_UNEXPECTED)
        return ok_payload(answer)
    if kind == "pending":
        return pending_payload(str(outcome.get("id")))
    if kind == "not-running":
        return error_payload(ERROR_NOT_RUNNING)
    if kind == "timeout":
        return error_payload(ERROR_TIMEOUT)
    return error_payload(ERROR_UNEXPECTED)
