#!/usr/bin/env python3
"""中继现场的极简读法：一行一转，别拿 `/status` 的 JSON 刷屏。

用法：``python3 scripts/watch-status.py [持续秒数] [间隔秒数]``

问句在途就一行一转（``/|\\-`` + 阶段 + 剩余秒），没问句打 ``- idle`` 停下，中继不可达打
``? 中继不可达``。端口默认 8787（中继的默认值），要改就设 ``DSB_PORT``。
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.request

SPIN = "|/-\\"


def status_url() -> str:
    port = os.environ.get("DSB_PORT") or "8787"
    return f"http://127.0.0.1:{port}/status"


def snapshot(url: str) -> dict[str, object] | None:
    """读一次现场；中继不可达回 ``None``。"""
    with urllib.request.urlopen(url, timeout=3) as response:
        body = json.load(response)
    return body.get("ask") if isinstance(body, dict) else None


def main() -> None:
    seconds = float(sys.argv[1]) if len(sys.argv) > 1 else 60.0
    interval = float(sys.argv[2]) if len(sys.argv) > 2 else 5.0
    url = status_url()
    deadline = time.time() + seconds
    spin = 0
    while time.time() < deadline:
        try:
            ask = snapshot(url)
        except Exception:
            print("? 中继不可达", flush=True)
            return
        if not ask:
            print("- idle", flush=True)
            return
        left = ask.get("remaining")
        print(f"{SPIN[spin % 4]} {ask.get('phase')} {'' if left is None else round(float(left))}")
        spin += 1
        time.sleep(interval)


if __name__ == "__main__":
    main()
