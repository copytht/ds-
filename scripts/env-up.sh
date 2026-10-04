#!/usr/bin/env bash
# 环境准备：起缺的、**活的一律不重启**，最后拿真判据验一次。
# 用法：scripts/env-up.sh      幂等，可反复跑。
#
# 两件人做的事（脚本做不了）在末尾打印，不猜、不代劳。
set -uo pipefail
cd "$(dirname "$0")/.."

CHROME=/Applications/Chromium.app/Contents/MacOS/Chromium
PROFILE="$HOME/Library/Application Support/ds-browser"
MV3="$PWD/.output/chrome-mv3"
PORT=8787
MCP="http://127.0.0.1:$PORT/mcp"

say() { printf '  %-8s %s\n' "$1" "$2"; }

# 一行 JSON-RPC 打 /mcp：唯一端点，探活 ping、查表 tools/list 都走它（ADR-0011）。
rpc() {
  curl -s -m 10 -X POST "$MCP" -H 'Content-Type: application/json' -d "$1"
}

# ---- 1) 扩展构建：源码比产物新才重建（老产物 = 协议说明旧、名册缺动作）----
REBUILT=0
if [ ! -f "$MV3/background.js" ]; then
  pnpm build >/tmp/dsb-build.log 2>&1 && { say 构建 "缺产物，已重建"; REBUILT=1; } || { say 构建 "重建失败 → /tmp/dsb-build.log"; exit 1; }
elif [ -n "$(find src entrypoints -name '*.ts' -newer "$MV3/background.js" 2>/dev/null | head -1)" ]; then
  pnpm build >/tmp/dsb-build.log 2>&1 && { say 构建 "源码较新，已重建"; REBUILT=1; } || { say 构建 "重建失败 → /tmp/dsb-build.log"; exit 1; }
else
  say 构建 "产物最新"
fi

# ---- 2) 中继 ----
if curl -s -m 3 -X POST "$MCP" -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":"env-up","method":"ping"}' | grep -q '"result"'; then
  say 中继 "已在跑"
  # dsb 是长驻进程、不重载代码：源码比进程新时跑的是旧代码。
  # 只提示、不擅自动——重启会丢子进程（mcp.json 里起着的 server 要重拉一遍）。
  RELAY_PID=$(lsof -nP -iTCP:$PORT -sTCP:LISTEN -t 2>/dev/null | head -1)
  NEWEST_PY=$(find dsb -name '*.py' -exec stat -f %m {} + 2>/dev/null | sort -rn | head -1)
  STARTED_AT=$(ps -p "${RELAY_PID:-0}" -o lstart= 2>/dev/null | python3 -c '
import sys
from datetime import datetime
raw = " ".join(sys.stdin.read().split())  # ps 的 lstart 日是空格填充的
try:
    print(int(datetime.strptime(raw, "%a %b %d %H:%M:%S %Y").timestamp()))
except ValueError:
    print("")')
  if [ -n "$NEWEST_PY" ] && [ -n "$STARTED_AT" ] && [ "$NEWEST_PY" -gt "$STARTED_AT" ]; then
    say 提示 "dsb 源码比中继进程新——跑的是旧代码：kill $RELAY_PID 后重跑本脚本才生效"
  fi
else
  # ping 不回话但端口有人占着 = 跑着旧代码的长驻中继（dsb 不重载代码，
  # 旧代码连 /mcp 路由都没有）。只提示、不擅自动：kill 会丢子进程
  # （mcp.json 里起着的 server 要重拉一遍）。
  RELAY_PID=$(lsof -nP -iTCP:$PORT -sTCP:LISTEN -t 2>/dev/null | head -1)
  if [ -n "$RELAY_PID" ]; then
    say 提示 "中继在跑（PID $RELAY_PID）却不答 ping：跑的是旧代码"
    say 提示 "kill $RELAY_PID 后重跑本脚本才生效（会丢它起的子进程，需重拉一遍）"
    exit 1
  fi
  nohup pnpm relay:dev >/tmp/dsb-relay.log 2>&1 &
  disown
  say 中继 "已起 → /tmp/dsb-relay.log"
fi

# ---- 3) 浏览器：只认独立 profile；已活着绝不重启（重启 = 掉 --load-extension）----
# 主进程的首个 flag 是 --user-data-dir，子进程是 --type=，据此只数主进程。
STARTED_BROWSER=0
if ps ax -o command= | grep -E '^/Applications/Chromium\.app/Contents/MacOS/Chromium --user-data-dir=.*ds-browser' >/dev/null 2>&1; then
  say 浏览器 "已在跑（独立 profile）"
  if [ "$REBUILT" = 1 ]; then
    say 提示 "刚重建过、浏览器却在跑：SW 吃的仍是旧脚本缓存，得重启浏览器才换新（本脚本起浏览器时会清缓存）"
  fi
else
  # 起浏览器前清 SW 脚本缓存：扩展版本号不变时，Chromium 把 SW 脚本缓存在
  # profile 里一直沿用（实测：SW 跑一天前的旧脚本，重建重启十几回都不换；
  # 内容脚本却随页面加载新构建——症状是「读类动作新、写类动作旧」）。
  # Database 是 SW 注册表（可再生成、无用户数据），一并清。
  rm -rf "$PROFILE/Default/Service Worker/ScriptCache" "$PROFILE/Default/Service Worker/Database"
  "$CHROME" --user-data-dir="$PROFILE" --load-extension="$MV3" \
    --no-first-run --no-default-browser-check >/tmp/dsb-browser.log 2>&1 &
  disown
  STARTED_BROWSER=1
  say 浏览器 "已起 → 独立 profile（清过 SW 脚本缓存）"
fi

# ---- 4) 判据 ----
# 扩展不再有外露的探针面（POST /action 与动作流随 ADR-0007 一起废了）：
# 这里只验本机这一半，扩展那一半看图标与控制台。
sleep 3

ping_out=$(rpc '{"jsonrpc":"2.0","id":"env-up","method":"ping"}')
case "$ping_out" in
  *'"result"'*) say 判据1 "中继健康（ping 回话）" ;;
  *) say 判据1 "中继不健康：$ping_out" ; exit 1 ;;
esac

list_out=$(rpc '{"jsonrpc":"2.0","id":"env-up","method":"tools/list"}')
tools=$(printf '%s' "$list_out" | python3 -c '
import json, sys
try:
    payload = json.load(sys.stdin)
except ValueError:
    print("")
    raise SystemExit
tools = payload.get("result", {}).get("tools")
if isinstance(tools, list):
    print(" ".join(t.get("name", "?") for t in tools))')
if [ -n "$tools" ]; then
  say 判据2 "工具表取得到：$tools"
else
  say 判据2 "工具表取不到 / 是空的：$list_out"
  say 判据2 "空 = mcp.json 没配 server（只剩自家 said_*）；取不到 = 网关有毛病 → /tmp/dsb-relay.log"
fi

if [ "$STARTED_BROWSER" = 1 ]; then
  "$CHROME" --user-data-dir="$PROFILE" --no-first-run \
    "https://chat.deepseek.com/" >/tmp/dsb-open.log 2>&1
  sleep 2
  say 判据3 "已开 chat.deepseek.com（浏览器是本脚本起的，转给在跑的实例）"
else
  say 判据3 "浏览器是先起的：有没有会话标签页这里问不到（扩展没有外露探针面）"
  say 判据3 "要开一个就：open -a Chromium 'https://chat.deepseek.com/'"
fi

cat <<EOF

  扩展那一半怎么验（本机探不到，看这三处）：
    1. 图标三态：关 / 绿(可达) / 红(带原因与 uv run dsb 启动命令)；转框 = 调用在途
    2. 悬停：总开关、账号处境、上次故障（时刻·环节·原因）都在标题里
    3. 页面控制台 [ds-] 开头的行：认出围栏、协议说明注入、回灌发没发出去

  人做的（只第一次，之后永久生效）：
    登录 DeepSeek 与勾「替人开口」都在**独立 profile** 这个窗口里做（跟主浏览器
    两套登录态）。勾「替人开口」那一步故意没有动作口（agent 不能自授发言权，
    围栏别拆）；不勾则 composer.type / send.* 回 disabled，属预期不是故障。

  查某动作为什么失败，两步就够：
    1. page.state 的 account 说清处境 —— muted(带解封时刻) / signed-out / unknown
    2. 失败码本身就说清是哪一步 —— composer-absent(没有写作框) / page-changed
       (页面上找不到认得的东西) / read-failed(读不完) / tab-gone(这一跳走不通)

  账号被禁言时（站点橙框「禁言至 …」，写作框不渲染）整条交流线是断的：
  那是账号在站点的处罚，不是扩展坏了。别去修选择器，那修不好；等解封。

  本脚本幂等：环境没坏就别重跑，重跑也不会动活着的浏览器。
EOF
