"""opencode 的结果 → status 载荷的映射（对拍：`protocol/fixtures/opencode.json`）。"""

from __future__ import annotations

from typing import Any

import pytest
from conftest import load_fixture

from dsb.opencode import (
    ERROR_NOT_RUNNING,
    ERROR_TIMEOUT,
    ERROR_UNEXPECTED,
    error_payload,
    extract_answer,
    ok_payload,
    payload_from_outcome,
    pending_payload,
)

OPENCODE_CASES = load_fixture("opencode.json")["cases"]


@pytest.mark.parametrize("case", OPENCODE_CASES, ids=[case["name"] for case in OPENCODE_CASES])
def test_maps_opencode_outcome_to_expected_payload(case: dict[str, Any]) -> None:
    assert payload_from_outcome(case["outcome"]) == case["expectedPayload"]


def test_ok_payload_shape() -> None:
    assert ok_payload("答案") == {"status": "ok", "answer": "答案"}


def test_error_payload_shape() -> None:
    assert error_payload(ERROR_TIMEOUT) == {"status": "error", "error": "opencode-timeout"}


def test_success_takes_the_last_assistant_message() -> None:
    body = [
        {"role": "assistant", "parts": [{"type": "text", "text": "旧答案"}]},
        {"role": "user", "parts": [{"type": "text", "text": "新问题"}]},
        {"role": "assistant", "parts": [{"type": "text", "text": "新答案"}]},
    ]
    assert extract_answer(body) == "新答案"


def test_text_parts_are_joined_with_a_newline() -> None:
    body = [
        {
            "role": "assistant",
            "parts": [{"type": "text", "text": "第一段"}, {"type": "text", "text": "第二段"}],
        }
    ]
    assert extract_answer(body) == "第一段\n第二段"


def test_non_text_parts_are_ignored() -> None:
    body = [
        {
            "role": "assistant",
            "parts": [
                {"type": "tool", "tool": "edit"},
                {"type": "text", "text": "只留正文"},
            ],
        }
    ]
    assert extract_answer(body) == "只留正文"


def test_missing_assistant_text_is_none() -> None:
    assert extract_answer([{"role": "assistant", "parts": []}]) is None
    assert extract_answer([{"role": "user", "parts": [{"type": "text", "text": "只有问"}]}]) is None
    assert extract_answer({"note": "不认识的形状"}) is None
    # 宿主这条线回的是一句纯文本——这是新形状，不再当「不认识」。
    assert extract_answer("不是消息列表") == "不是消息列表"
    assert extract_answer("   ") is None


def test_success_without_answerable_text_is_an_error() -> None:
    assert payload_from_outcome({"kind": "success", "body": {"note": "看不懂"}}) == error_payload(
        ERROR_UNEXPECTED
    )


def test_recognised_failure_branches() -> None:
    assert payload_from_outcome({"kind": "not-running"}) == error_payload(ERROR_NOT_RUNNING)
    assert payload_from_outcome({"kind": "timeout"}) == error_payload(ERROR_TIMEOUT)
    assert payload_from_outcome({"kind": "http-error", "status": 500}) == error_payload(
        ERROR_UNEXPECTED
    )


def test_unrecognised_outcome_falls_back_to_an_error() -> None:
    assert payload_from_outcome({"kind": "谁也没说过的分支"}) == error_payload(ERROR_UNEXPECTED)
    assert payload_from_outcome("不是分支") == error_payload(ERROR_UNEXPECTED)  # type: ignore[arg-type]


def test_pending_outcome_carries_the_id_so_the_caller_can_ask_again() -> None:
    assert payload_from_outcome({"kind": "pending", "id": "q-1"}) == pending_payload("q-1")
