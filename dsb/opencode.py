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


def answer_complete(body: Any) -> bool:
    """最后一轮 assistant 的消息是否**已定稿**：正文非空，且 ``time.completed`` 已落。

    实测：流式途中消息的 ``time`` 只有 ``created``，这一轮跑完才补上 ``streamed`` /
    ``completed``。opencode 一轮里正文还会分几段（先「让我读一下文件」，末段才是答复），
    只认 ``completed`` 落下的那条，免得把中途一句当答完、剩下的活没人看。
    """
    if extract_answer(body) is None:
        return False
    if not isinstance(body, list):
        return True  # 单条消息形状（测试替身）：取得到正文就算数
    messages = [m for m in body if isinstance(m, Mapping) and m.get("role") == "assistant"]
    if not messages:
        return False
    time_field = messages[-1].get("time")
    if not isinstance(time_field, Mapping):
        return True  # 认不出时间：不拿它卡链子
    return bool(time_field.get("completed"))


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
