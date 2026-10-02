"""opencode 的结果 → status 载荷的映射（对拍：`protocol/fixtures/opencode.json`）。"""

from __future__ import annotations

from typing import Any

import pytest
from conftest import load_fixture

from dsb.opencode import (
    ERROR_NOT_RUNNING,
    ERROR_TIMEOUT,
    ERROR_UNEXPECTED,
    answer_complete,
    error_payload,
    extract_answer,
    has_assistant,
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


def test_has_assistant_counts_an_empty_answer_as_started() -> None:
    """正文空着也算「开写了」——中继靠它把 /status 的阶段推进到「在写」。"""
    assert has_assistant([{"role": "assistant", "parts": []}]) is True
    assert (
        has_assistant([{"role": "user", "parts": []}, {"role": "assistant", "parts": []}]) is True
    )
    only_user = [{"role": "user", "parts": [{"type": "text", "text": "还没开工"}]}]
    assert has_assistant(only_user) is False
    assert has_assistant([]) is False
    assert has_assistant({"note": "不认识的形状"}) is False
    assert has_assistant("不是消息列表") is False


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


def _assistant(text: str, completed: Any = ...) -> dict[str, Any]:
    time: dict[str, Any] = {"created": 2}
    if completed is not ...:
        time["completed"] = completed
    return {"role": "assistant", "time": time, "parts": [{"type": "text", "text": text}]}


def test_answer_complete_waits_for_the_turn_to_finish() -> None:
    """一轮里正文会分几段，只在 ``time.completed`` 落下后才算答完（真机实测的形状）。"""
    assert answer_complete([_assistant("让我读一下文件", completed=3)]) is True
    assert answer_complete([_assistant("让我读一下文件")]) is False  # 流式中：还没 completed
    assert answer_complete([_assistant("", completed=3)]) is False  # 定稿了但没正文
    assert answer_complete([{"role": "user", "parts": []}]) is False
    # 认不出时间的旧形状：不拿它卡链子
    bare = [{"role": "assistant", "parts": [{"type": "text", "text": "答"}]}]
    assert answer_complete(bare) is True


def test_answer_complete_reads_the_last_assistant_message() -> None:
    """多段消息里看最后那条：前一段写完了、末段还在流，就不算完。"""
    body = [_assistant("先读文件", completed=3), _assistant("真正的答复")]
    assert answer_complete(body) is False
    done = [_assistant("先读文件", completed=3), _assistant("真正的答复", completed=9)]
    assert answer_complete(done) is True
