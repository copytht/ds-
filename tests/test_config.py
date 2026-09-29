"""配置解析（对拍：`protocol/fixtures/config.json`）：只解析，不发任何请求。"""

from __future__ import annotations

from typing import Any

import pytest
from conftest import load_fixture

from dsb.config import SESSION_ID_ENV_KEY, parse_password, parse_service_endpoint, parse_session_id

CONFIG_CASES = load_fixture("config.json")["cases"]


@pytest.mark.parametrize("case", CONFIG_CASES, ids=[case["name"] for case in CONFIG_CASES])
def test_parses_config_fixture_case(case: dict[str, Any]) -> None:
    kind = case["kind"]
    if kind == "port":
        actual: dict[str, Any] = parse_service_endpoint(case["input"])
    elif kind == "password":
        actual = {"password": parse_password(case["input"])}
    elif kind == "session-id":
        actual = {"session_id": parse_session_id(case["input"])}
    else:
        raise AssertionError(f"认不出的配置分支：{kind}")
    assert actual == case["expected"]


def test_endpoint_rejects_empty_output() -> None:
    with pytest.raises(ValueError):
        parse_service_endpoint("")
    with pytest.raises(ValueError):
        parse_service_endpoint("只有空行\n\n")


def test_endpoint_rejects_a_url_without_port() -> None:
    with pytest.raises(ValueError):
        parse_service_endpoint("http://127.0.0.1")


def test_endpoint_takes_the_last_non_empty_line() -> None:
    assert parse_service_endpoint("\nhttp://127.0.0.1:1234\n")["port"] == 1234


def test_password_rejects_empty_output() -> None:
    with pytest.raises(ValueError):
        parse_password("  \n")


def test_session_id_ignores_comments_and_other_keys() -> None:
    env = "# 注释\nOTHER=1\nOPENSESS_ID=ses_def\nTRAILING=2\n"
    assert parse_session_id(env) == "ses_def"


def test_session_id_strips_quotes() -> None:
    env = f'{SESSION_ID_ENV_KEY}="ses_quoted"\n'
    assert parse_session_id(env) == "ses_quoted"


def test_session_id_missing_returns_none() -> None:
    assert parse_session_id("OTHER=1\n") is None
    assert parse_session_id("") is None
    assert parse_session_id(f"{SESSION_ID_ENV_KEY}=\n") is None
