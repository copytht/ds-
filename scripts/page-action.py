#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets"]
# ///
"""页面动作真机探针（开发用）：经 CDP 把一件页面动作发给 DeepSeek 标签页的内容脚本名册。

外部动作口随 ADR-0011 废掉后，没有外露探针面；这个脚本补上开发期的那只手：
动作走扩展自己的名册（内容脚本 `ACTION_ROSTER`），绕开 `runAction` 的三道闸（总开关 /
替人开口 / 退避）——那是给产品路径用的，探针要能直接验执行器。只读页面 DOM 与驱动扩展
自身，不 hook 站点、不碰令牌（issue #31 的硬边界）。

前置：ds-browser 带调试口起（`--remote-debugging-port=9222`）。缺了它会打印怎么起。

用法：
  uv run scripts/page-action.py list
  uv run scripts/page-action.py read
  uv run scripts/page-action.py send stop.click
  uv run scripts/page-action.py send composer.type --params '{"text": "你好"}'
  uv run scripts/page-action.py storage get --keys '["backoffUntil","toggle","speak"]'

环境：
  DSB_CDP_PORT   调试口端口，默认 9222
  DSB_EXT_DIR    扩展构建目录，默认 <repo>/.output/chrome-mv3（扩展 id 由它推出）
  DSB_SITE_MATCH 目标标签页 url 前缀，默认 https://chat.deepseek.com/
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

import websockets

PORT = int(os.environ.get("DSB_CDP_PORT", "9222"))
CDP = f"http://127.0.0.1:{PORT}"
REPO = Path(__file__).resolve().parent.parent
EXT_DIR = Path(os.environ.get("DSB_EXT_DIR", str(REPO / ".output" / "chrome-mv3")))
SITE_MATCH = os.environ.get("DSB_SITE_MATCH", "https://chat.deepseek.com/")

#: 站点上的动作信封（与 `src/lib/channel.ts` 的 `ACTION_MESSAGE_TYPE` 同一份）。
ACTION_MESSAGE_TYPE = "ds-/action"

READ_EXPR = """(() => {
  const SEL =
    'div[role="button"].ds-button--primary.ds-button--filled.ds-button--circle';
  const circle = document.querySelector(SEL);
  const composer = document.querySelector("textarea, [contenteditable='true']");
  const alert = document.querySelector(".ds-alert__content");
  const icon = circle ? circle.querySelector("svg path")?.getAttribute("d") || null : null;
  return JSON.stringify({
    url: location.href,
    title: document.title,
    composer: !!composer,
    circleIcon: icon ? icon.slice(0, 24) : null,
    circleDisabled: circle ? circle.classList.contains("ds-button--disabled") : null,
    stopDetect: {
      found: !!circle,
      visible: circle ? circle.getClientRects().length > 0 : null,
      pathStart: icon ? icon.slice(0, 24) : null,
      isStop: icon ? icon.startsWith("M2 4.88C2 3.68009") : null,
      isSend: icon ? icon.startsWith("M8.3125 0.980206") : null,
    },
    alert: alert ? alert.textContent.slice(0, 120) : null,
  });
})()"""


def extension_id() -> str:
    """未打包扩展的 id：取扩展目录绝对路径 SHA-256 前 16 字节，每半字节映到 a~p。"""
    digest = hashlib.sha256(str(EXT_DIR).encode()).hexdigest()[:32]
    return "".join(chr(ord("a") + int(ch, 16)) for ch in digest)


def http_json(path: str) -> object:
    with urllib.request.urlopen(f"{CDP}{path}", timeout=3) as resp:
        return json.load(resp)


def open_tab(url: str) -> dict:
    query = urllib.parse.quote(url, safe="")
    req = urllib.request.Request(f"{CDP}/json/new?{query}", method="PUT")
    with urllib.request.urlopen(req, timeout=5) as resp:
        return json.load(resp)


def targets() -> list[dict]:
    return http_json("/json/list")  # type: ignore[return-value]


def find_target(kind: str, needle: str, timeout: float = 0.0) -> dict | None:
    deadline = time.monotonic() + timeout
    while True:
        for target in targets():
            if target.get("type") == kind and needle in target.get("url", ""):
                return target
        if time.monotonic() >= deadline:
            return None
        time.sleep(0.3)


async def evaluate(ws_url: str, expression: str) -> object:
    async with websockets.connect(ws_url, max_size=None) as ws:
        await ws.send(
            json.dumps(
                {
                    "id": 1,
                    "method": "Runtime.evaluate",
                    "params": {
                        "expression": expression,
                        "awaitPromise": True,
                        "returnByValue": True,
                    },
                }
            )
        )
        while True:
            message = json.loads(await ws.recv())
            if message.get("id") == 1:
                return message


def run(ws_url: str, expression: str) -> object:
    return asyncio.run(evaluate(ws_url, expression))


async def call_cdp(ws_url: str, method: str, params: dict | None = None) -> object:
    """发一条 CDP 命令，取它的回包（不带 id 的事件直接跳过）。"""
    async with websockets.connect(ws_url, max_size=None) as ws:
        await ws.send(json.dumps({"id": 1, "method": method, "params": params or {}}))
        while True:
            message = json.loads(await ws.recv())
            if message.get("id") == 1:
                return message


def ax_nodes(tab: dict) -> list[dict]:
    """取整棵**无障碍树**（role + 可访问名，浏览器算出来的）。先 enable 再要全量。"""
    ws_url = tab["webSocketDebuggerUrl"]
    asyncio.run(call_cdp(ws_url, "Accessibility.enable"))
    reply = asyncio.run(call_cdp(ws_url, "Accessibility.getFullAXTree"))
    result = reply.get("result") if isinstance(reply, dict) else None
    nodes = result.get("nodes") if isinstance(result, dict) else None
    return nodes if isinstance(nodes, list) else []


def ax_line(node: dict) -> str:
    """一行的紧凑视图：role + 可访问名（+ value / 几个关键属性）。"""
    role = (node.get("role") or {}).get("value", "?")
    name = (node.get("name") or {}).get("value", "")
    extras: list[str] = []
    value = (node.get("value") or {}).get("value")
    if value not in (None, ""):
        extras.append(f"value={value!r}")
    for prop in node.get("properties") or []:
        key = prop.get("name")
        if key in ("editable", "disabled", "focused", "placeholder"):
            extras.append(f"{key}={prop.get('value', {}).get('value')!r}")
    tail = ("  " + " ".join(extras)) if extras else ""
    return f"{role:<18} {name[:70]}{tail}"


def read_state() -> dict:
    tab = ensure_site_tab()
    value = unwrap(run(tab["webSocketDebuggerUrl"], READ_EXPR))
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return {"raw": value}
    return value if isinstance(value, dict) else {"raw": value}


def poll_state(predicate, timeout: float, interval: float = 0.25) -> dict:
    deadline = time.monotonic() + timeout
    state = read_state()
    while not predicate(state):
        if time.monotonic() >= deadline:
            break
        time.sleep(interval)
        state = read_state()
    return state


def require_cdp() -> None:
    try:
        http_json("/json/version")
    except Exception:  # noqa: BLE001 - 连不上就是没带调试口，给出人话
        print(
            f"[page-action] CDP 连不上（{CDP}）。ds-browser 要带调试口起：\n"
            f"  scripts/env-up.sh --debug   # 或手动：\n"
            f'  "$CHROME" --user-data-dir="$HOME/Library/Application Support/ds-browser" \\\n'
            f'    --load-extension="{EXT_DIR}" --remote-debugging-port={PORT} \\\n'
            f"    --no-first-run --no-default-browser-check",
            file=sys.stderr,
        )
        raise SystemExit(2) from None


def ensure_site_tab() -> dict:
    tab = find_target("page", SITE_MATCH)
    if tab is None:
        print(f"[page-action] 没有 {SITE_MATCH} 标签页，开一个")
        tab = open_tab(SITE_MATCH)
        opened = find_target("page", SITE_MATCH, timeout=10)
        tab = opened or tab
    return tab


def ensure_extension_page() -> dict:
    """扩展页上下文（options）：拿得到 `chrome.tabs.sendMessage`，且不像 SW 那样会睡。"""
    tab = find_target("page", "chrome-extension://")
    if tab is not None:
        return tab
    print("[page-action] 没有扩展页，开 options.html 当消息入口")
    open_tab(f"chrome-extension://{extension_id()}/options.html")
    tab = find_target("page", "chrome-extension://", timeout=10)
    if tab is None:
        print("[page-action] 扩展页没起来", file=sys.stderr)
        raise SystemExit(3)
    return tab


def send_action(action: str, params: dict) -> object:
    ext = ensure_extension_page()
    frame = {
        "type": "action",
        "id": f"probe-{int(time.time() * 1000)}",
        "action": action,
        "params": params,
        "target": None,
    }
    script = (
        "(async () => {"
        "  const tabs = await chrome.tabs.query({});"
        f"  const t = tabs.find((x) => x.url && x.url.startsWith({json.dumps(SITE_MATCH)}));"
        "  if (!t) return JSON.stringify({ error: 'no-site-tab' });"
        f"  const frame = {json.dumps(frame)};"
        "  frame.target = String(t.id);"
        f"  const envelope = {{ type: {json.dumps(ACTION_MESSAGE_TYPE)}, frame }};"
        "  const r = await chrome.tabs.sendMessage(t.id, envelope);"
        "  return JSON.stringify(r);"
        "})()"
    )
    result = run(ext["webSocketDebuggerUrl"], script)
    return unwrap(result)


def storage_op(op: str, keys_json: str, data_json: str) -> object:
    """读写扩展 storage.local：开发探针要看 / 清退避这类持久态，从扩展页上下文发。"""
    ext = ensure_extension_page()
    try:
        keys = json.loads(keys_json)
        data = json.loads(data_json)
    except json.JSONDecodeError as error:
        print(f"[page-action] --keys/--data 不是合法 JSON：{error}", file=sys.stderr)
        raise SystemExit(2) from error
    if op == "get":
        script = f"chrome.storage.local.get({json.dumps(keys)}).then((v) => JSON.stringify(v))"
    elif op == "remove":
        script = (
            f"chrome.storage.local.remove({json.dumps(keys)})"
            ".then(() => JSON.stringify({ ok: true }))"
        )
    else:
        script = (
            f"chrome.storage.local.set({json.dumps(data)})"
            ".then(() => JSON.stringify({ ok: true }))"
        )
    return unwrap(run(ext["webSocketDebuggerUrl"], script))


def unwrap(message: object) -> object:
    """从 CDP Runtime.evaluate 的回包取 value，顺带把异常说清楚。"""
    if not isinstance(message, dict):
        return message
    result = message.get("result", {})
    if "exceptionDetails" in result:
        return {"cdp-error": result["exceptionDetails"].get("text"), "raw": result}
    return result.get("result", {}).get("value")


def main() -> None:
    parser = argparse.ArgumentParser(description="页面动作真机探针（开发用）")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("list", help="列 CDP 目标")
    sub.add_parser("read", help="读 DeepSeek 页面状态")
    js = sub.add_parser("js", help="在 DeepSeek 页面上下文里跑一段只读 JS，打印结果")
    js.add_argument("expression", help="要 evaluate 的 JS 表达式（建议用 IIFE 返回字符串）")
    stop_test = sub.add_parser("stop-test", help="端到端验 stop.click：起生成→等停止键→点→等复位")
    stop_test.add_argument(
        "--text",
        default="请写一篇 3000 字的散文，主题是海边的灯塔，分段，慢慢写，一定要写满。",
        help="用来起生成的长消息",
    )
    stop_test.add_argument("--timeout", type=float, default=40.0, help="等某一相的秒数上限")
    send = sub.add_parser("send", help="给 DeepSeek 标签页发一件页面动作")
    send.add_argument("action", help="动作名，如 stop.click")
    send.add_argument("--params", default="{}", help="动作参数 JSON，默认 {}")
    storage = sub.add_parser("storage", help="读写扩展 storage.local（开发探针）")
    storage.add_argument("op", choices=["get", "set", "remove"], help="get 读 / set 写 / remove 删")
    storage.add_argument("--keys", default="[]", help="get / remove 的键数组（JSON）")
    storage.add_argument("--data", default="{}", help="set 的对象（JSON）")
    ax = sub.add_parser("ax", help="dump 无障碍树（role + 可访问名；只读，开发探针）")
    ax.add_argument("--grep", default="", help="只打印 role/name/value 命中该串的节点")
    ax.add_argument("--max", type=int, default=80, help="最多打印多少行，默认 80")
    ax.add_argument("--all", action="store_true", help="连 ignored 的节点也打印")
    args = parser.parse_args()

    require_cdp()

    if args.command == "list":
        for target in targets():
            print(f"{target.get('type'):<16} {target.get('url', '')[:100]}")
        return

    if args.command == "read":
        tab = ensure_site_tab()
        value = unwrap(run(tab["webSocketDebuggerUrl"], READ_EXPR))
        print(json.dumps(value, ensure_ascii=False, indent=2))
        return

    if args.command == "js":
        tab = ensure_site_tab()
        print(
            json.dumps(
                unwrap(run(tab["webSocketDebuggerUrl"], args.expression)),
                ensure_ascii=False,
                indent=2,
            )
        )
        return

    if args.command == "stop-test":
        report: dict = {}

        def is_stop(state: dict) -> bool:
            return bool(state.get("stopDetect", {}).get("isStop"))

        def is_send(state: dict) -> bool:
            return bool(state.get("stopDetect", {}).get("isSend"))

        print(f"[stop-test] 起生成：{args.text[:40]}…")
        report["type"] = send_action("composer.type", {"text": args.text})
        report["enter"] = send_action("send.enter", {})
        state = poll_state(is_stop, args.timeout)
        report["started"] = is_stop(state)
        report["atStop"] = state.get("stopDetect")
        print(f"[stop-test] 进入停止相：{report['started']}  icon={state.get('circleIcon')}")
        if report["started"]:
            report["stop"] = send_action("stop.click", {})
            print(f"[stop-test] stop.click -> {json.dumps(report['stop'], ensure_ascii=False)}")
            state2 = poll_state(is_send, args.timeout)
            report["stopped"] = is_send(state2)
            report["afterStop"] = state2.get("stopDetect")
            print(
                f"[stop-test] 停后回到发送相：{report['stopped']}  icon={state2.get('circleIcon')}"
            )
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return

    if args.command == "send":
        try:
            params = json.loads(args.params)
        except json.JSONDecodeError as error:
            print(f"[page-action] --params 不是合法 JSON：{error}", file=sys.stderr)
            raise SystemExit(2) from error
        if not isinstance(params, dict):
            print("[page-action] --params 必须是对象", file=sys.stderr)
            raise SystemExit(2)
        print(
            json.dumps(send_action(args.action, params), ensure_ascii=False, indent=2),
        )
        return

    if args.command == "storage":
        print(
            json.dumps(storage_op(args.op, args.keys, args.data), ensure_ascii=False, indent=2),
        )
        return

    if args.command == "ax":
        tab = ensure_site_tab()
        nodes = ax_nodes(tab)
        shown = 0
        for node in nodes:
            if node.get("ignored") and not args.all:
                continue
            line = ax_line(node)
            if args.grep and args.grep not in line:
                continue
            print(line)
            shown += 1
            if shown >= args.max:
                break
        if shown == 0:
            print(f"（没有命中；共 {len(nodes)} 个节点）")
        else:
            print(f"—— 打住：{shown} 行 / 共 {len(nodes)} 个节点（--max 调大 / --grep 收窄）")
        return


if __name__ == "__main__":
    main()
