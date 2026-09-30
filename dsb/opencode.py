"""opencode 的结果 → 回灌载荷的映射（纯函数，不发任何请求）。

中继只产出结构化 dict，TOON 编码归扩展（spec #9：Python 侧不引任何 TOON 库）。
HTTP 层（#11）把现场折成这里认的 outcome 分支：

- ``success`` + 响应体：正常答复，响应体形如 ``GET /api/session/{id}/message`` 的消息列表；
- ``not-running``：opencode 后台服务没起；
- ``timeout``：等答复超时；
- ``http-error`` + ``status``：中继自己收到了非 2xx。
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


ReplyPayload = OkPayload | ErrorPayload


def ok_payload(answer: str) -> OkPayload:
    """status: ok + answer。"""
    return {"status": "ok", "answer": answer}


def error_payload(code: str) -> ErrorPayload:
    """status: error + error（可识别的错误码，扩展据此出失败提示）。"""
    return {"status": "error", "error": code}


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


def has_assistant(body: Any) -> bool:
    """消息列表里有没有 assistant 消息（哪怕正文还空着）。

    与 :func:`extract_answer` 的区别是它只认「答复已经开写」这件事：正文空着
    也算数。中继靠它把 `/status` 的阶段从「还在想」推进到「在写」
    （见 :meth:`dsb.client.OpencodeClient._await_answer`）。
    """
    if not isinstance(body, list):
        return False
    return any(isinstance(m, Mapping) and m.get("role") == "assistant" for m in body)


def extract_answer(body: Any) -> str | None:
    """从消息响应体里取最后一轮 assistant 的文本；取不到返回 None。"""
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


def payload_from_outcome(outcome: Mapping[str, Any] | Any) -> ReplyPayload:
    """把 outcome 分支映射成回灌载荷；认不出的一律算非预期响应。"""
    if not isinstance(outcome, Mapping):
        return error_payload(ERROR_UNEXPECTED)

    kind = outcome.get("kind")
    if kind == "success":
        answer = extract_answer(outcome.get("body"))
        if answer is None:
            return error_payload(ERROR_UNEXPECTED)
        return ok_payload(answer)
    if kind == "not-running":
        return error_payload(ERROR_NOT_RUNNING)
    if kind == "timeout":
        return error_payload(ERROR_TIMEOUT)
    return error_payload(ERROR_UNEXPECTED)
