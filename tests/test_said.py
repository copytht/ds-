"""网页说给人听的话：`/said` 的收与取。"""

from __future__ import annotations

import json

from dsb.said import SaidLog, parse_said


def test_parse_only_accepts_the_wire_shape() -> None:
    assert parse_said(json.dumps({"text": "你好"}).encode()) == "你好"
    assert parse_said(json.dumps({"text": "   "}).encode()) is None
    assert parse_said(json.dumps({"text": 42}).encode()) is None
    assert parse_said(json.dumps({"nope": "字段名反了"}).encode()) is None
    assert parse_said("中文不是 json".encode()) is None
    assert parse_said(b"[]") is None


def test_add_then_read_roundtrip() -> None:
    log = SaidLog()
    assert log.add(json.dumps({"text": "第一条"}).encode()) == (200, {"status": "ok"})

    status, payload = log.read()
    assert status == 200
    assert [item["text"] for item in payload["said"]] == ["第一条"]


def test_keeps_only_the_last_ones() -> None:
    log = SaidLog(limit=2)
    for i in range(3):
        log.add(json.dumps({"text": f"第{i}条"}).encode())

    assert [item["text"] for item in log.read()[1]["said"]] == ["第1条", "第2条"]


def test_a_bad_body_is_a_400() -> None:
    status, payload = SaidLog().add(b'{"nope": 1}')

    assert status == 400
    assert payload["status"] == "error"
