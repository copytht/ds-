"""共享 fixture 的完整性与两半对拍：改一边必须在这里或 vitest 那边被发现。"""

from __future__ import annotations

from typing import Any

from conftest import load_fixture, load_fixture_filenames

EXPECTED_FILES = ["config.json", "fence.json", "opencode.json", "reply.json"]
REPLY_ANCHOR = "agent:"


def raw_cases(filename: str) -> list[dict[str, Any]]:
    cases = load_fixture(filename)["cases"]
    assert isinstance(cases, list)
    for case in cases:
        assert isinstance(case, dict), f"{filename} 的 case 不是对象：{case!r}"
    return cases


def assert_reply_payload(payload: Any) -> None:
    """载荷必须是 status + answer / error 的同构形状（spec #9）。"""
    assert isinstance(payload, dict)
    assert payload.get("status") in {"ok", "error"}
    if payload["status"] == "ok":
        assert isinstance(payload.get("answer"), str)
        assert "error" not in payload
    else:
        assert isinstance(payload.get("error"), str)
        assert "answer" not in payload


def test_every_fixture_file_is_present() -> None:
    assert load_fixture_filenames() == EXPECTED_FILES


def test_each_fixture_has_a_description_and_cases() -> None:
    for filename in EXPECTED_FILES:
        fixture = load_fixture(filename)
        assert isinstance(fixture["description"], str)
        assert fixture["description"], filename
        assert fixture["cases"], filename


def test_case_names_are_unique_within_each_file() -> None:
    for filename in EXPECTED_FILES:
        names = [case["name"] for case in raw_cases(filename)]
        assert all(isinstance(name, str) and name for name in names)
        assert len(set(names)) == len(names), filename


def test_fence_cases_are_coherent() -> None:
    """抽出问题的输入里必须排着 ask 围栏；其余输入只能落空。"""
    for case in raw_cases("fence.json"):
        assert isinstance(case["input"], str)
        question = case["expectedQuestion"]
        assert question is None or isinstance(question, str)
        if question is not None:
            assert question
            assert "```ask" in case["input"], case["name"]


def test_reply_payloads_follow_the_schema() -> None:
    for case in raw_cases("reply.json"):
        assert_reply_payload(case["payload"])


def test_reply_message_starts_with_the_anchor() -> None:
    for case in raw_cases("reply.json"):
        lines = case["expectedMessage"].split("\n")
        assert lines[0] == REPLY_ANCHOR, case["name"]
        assert "status:" in "\n".join(lines[1:]), case["name"]


def test_opencode_payloads_follow_the_schema() -> None:
    for case in raw_cases("opencode.json"):
        assert_reply_payload(case["expectedPayload"])


def test_reply_payloads_come_from_the_relay_mapping() -> None:
    """对拍：回灌侧用到的载荷，中继侧的映射必须产得出（反之亦然的那半在 vitest）。"""
    relay_payloads = [case["expectedPayload"] for case in raw_cases("opencode.json")]
    for case in raw_cases("reply.json"):
        assert case["payload"] in relay_payloads, case["name"]


def test_config_cases_cover_known_kinds() -> None:
    for case in raw_cases("config.json"):
        assert case["kind"] in {"port", "password", "session-id"}
        assert isinstance(case["input"], str)
        assert isinstance(case["expected"], dict)
