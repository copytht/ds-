#!/usr/bin/env bash
# 环境准备：起缺的、**旧代码自动换**（ds-browser 装的扩展比构建旧会自动
# 重启；中继跑旧代码提示 kill），最后拿真判据验一次。
# 用法：scripts/env-up.sh [--status]   幂等，可反复跑；--status 只读汇总。
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

# 一行 JSON-RPC 打 /mcp：唯一端点（ADR-0011）——自检 initialize、
# 查表 tools/list 都走它；扩展的周期探活是 ping（dsb 记日志）。
rpc() {
  curl -s -m 10 -X POST "$MCP" -H 'Content-Type: application/json' -d "$1"
}

# 起 ds-browser：先清 SW 脚本缓存（扩展版本号不变时，Chromium 把 SW
# 脚本缓存在 profile 里一直沿用——实测 SW 跑一天前的旧脚本，重启十几回
# 都不换；内容脚本却随页面加载新构建，症状是「读类动作新、写类动作旧」）。
# Database 是 SW 注册表（可再生成、无用户数据），一并清。
start_browser() {
  rm -rf "$PROFILE/Default/Service Worker/ScriptCache" "$PROFILE/Default/Service Worker/Database"
  "$CHROME" --user-data-dir="$PROFILE" --load-extension="$MV3" \
    --no-first-run --no-default-browser-check >/tmp/dsb-browser.log 2>&1 &
  disown
  STARTED_BROWSER=1
  say 浏览器 "已起 → 独立 profile（清过 SW 脚本缓存）"
}

# ds-browser 的主进程 PID：主进程的首个 flag 是 --user-data-dir，
# 子进程是 --type=，据此只数主进程。没有回空。
browser_main_pid() {
  ps ax -o pid=,command= | grep -E '^ *[0-9]+ /Applications/Chromium\.app/Contents/MacOS/Chromium --user-data-dir=.*ds-browser' | head -1 | awk '{print $1}'
}

# 任意进程的启动时刻（epoch 秒；拿不到回空）。ps 的 lstart 日是
# 空格填充的，先压成单空格再解析。
proc_started() {
  ps -p "$1" -o lstart= 2>/dev/null | python3 -c '
import sys
from datetime import datetime
raw = " ".join(sys.stdin.read().split())
try:
    print(int(datetime.strptime(raw, "%a %b %d %H:%M:%S %Y").timestamp()))
except ValueError:
    print("")'
}

# 扩展最后探活距今几秒：读候选日志里最后一条 `] ping` 行（事件名
# 固定、无字段，是 dsb/mcp.py 的 ping 分支留的）。候选是 env-up
# 起的中继（/tmp/dsb-relay.log）与 dsb/log.py 约定的自起写法
# （/tmp/dsb.log）。回 -1 = 候选日志一个都读不开（中继可能不是
# 本脚本起的、日志在别处）；-2 = 日志读到了但没有探活痕迹（扩展
# 没探活，或中继跑旧代码不记 ping）。总开关关着时扩展不探活——
# 「没有新痕迹」是常态，不是故障。
last_probe_age() {
  python3 - <<'PY'
from datetime import datetime

now = datetime.now()
readable = False
best = None
for path in ("/tmp/dsb-relay.log", "/tmp/dsb.log"):
    try:
        with open(path, errors="replace") as handle:
            readable = True
            for line in handle:
                if not line.rstrip().endswith("] ping"):
                    continue
                try:
                    when = datetime.strptime(line[1:20], "%Y-%m-%d %H:%M:%S")
                except ValueError:
                    continue
                if best is None or when > best:
                    best = when
    except OSError:
        continue
if not readable:
    print(-1)
elif best is None:
    print(-2)
else:
    print(max(0, int((now - best).total_seconds())))
PY
}

# ---- --status：只读汇总，不改动任何东西 ----
if [ "${1:-}" = "--status" ]; then
  if [ ! -f "$MV3/background.js" ]; then
    say 构建 "缺产物（跑 env-up 重建）"
  elif [ -n "$(find src entrypoints -name '*.ts' -newer "$MV3/background.js" 2>/dev/null | head -1)" ]; then
    say 构建 "源码较产物新（跑 env-up 重建）"
  else
    say 构建 "产物最新"
  fi
  RELAY_PID=$(lsof -nP -iTCP:$PORT -sTCP:LISTEN -t 2>/dev/null | head -1)
  if [ -n "$RELAY_PID" ]; then
    if rpc '{"jsonrpc":"2.0","id":"status","method":"initialize"}' | grep -q '"result"'; then
      say 中继 "在跑（PID ${RELAY_PID}），健康"
    else
      say 中继 "在跑（PID ${RELAY_PID}）却不答 initialize：跑的是旧代码"
    fi
  else
    say 中继 "没在跑（跑 env-up 起）"
  fi
  BROWSER_MAIN=$(browser_main_pid)
  if [ -n "$BROWSER_MAIN" ]; then
    BROWSER_STARTED=$(proc_started "$BROWSER_MAIN")
    BUILD_MTIME=$(stat -f %m "$MV3/background.js" 2>/dev/null || echo 0)
    if [ -n "$BROWSER_STARTED" ] && [ "$BUILD_MTIME" -gt "$BROWSER_STARTED" ]; then
      say 浏览器 "在跑（PID ${BROWSER_MAIN}），但装的扩展比构建旧——跑 env-up 换"
    else
      say 浏览器 "在跑（PID ${BROWSER_MAIN}），扩展是新的"
    fi
  else
    say 浏览器 "没在跑（跑 env-up 起）"
  fi
  age=$(last_probe_age)
  if [ "$age" = "-1" ]; then
    say 探活 "读不到（中继可能不是本脚本起的、日志在别处）"
  elif [ "$age" = "-2" ]; then
    say 探活 "日志在但没有痕迹：扩展没探活（总开关关着是常态），或中继跑旧代码（不记 ping）"
  elif [ "$age" -gt 90 ]; then
    say 探活 "${age}s 前没探活：总开关关着 / SW 死了 / 浏览器关了（关着是常态）"
  else
    say 探活 "新鲜（${age}s 前）：扩展活着且总开关开着"
  fi
  exit 0
fi

# ---- 1) 扩展构建：源码比产物新才重建（老产物 = 协议说明旧、名册缺动作）----
if [ ! -f "$MV3/background.js" ]; then
  pnpm build >/tmp/dsb-build.log 2>&1 && say 构建 "缺产物，已重建" || { say 构建 "重建失败 → /tmp/dsb-build.log"; exit 1; }
elif [ -n "$(find src entrypoints -name '*.ts' -newer "$MV3/background.js" 2>/dev/null | head -1)" ]; then
  pnpm build >/tmp/dsb-build.log 2>&1 && say 构建 "源码较新，已重建" || { say 构建 "重建失败 → /tmp/dsb-build.log"; exit 1; }
else
  say 构建 "产物最新"
fi

# ---- 2) 中继 ----
# 自检走 initialize（不记日志）：dsb 记 ping，ping 日志即纯扩展信号。
RELAY_JUST_STARTED=0
if curl -s -m 3 -X POST "$MCP" -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":"env-up","method":"initialize"}' | grep -q '"result"'; then
  say 中继 "已在跑"
  # dsb 是长驻进程、不重载代码：源码比进程新时跑的是旧代码。
  # 只提示、不擅自动——重启会丢子进程（mcp.json 里起着的 server 要重拉一遍）。
  RELAY_PID=$(lsof -nP -iTCP:$PORT -sTCP:LISTEN -t 2>/dev/null | head -1)
  NEWEST_PY=$(find dsb -name '*.py' -exec stat -f %m {} + 2>/dev/null | sort -rn | head -1)
  STARTED_AT=$(proc_started "${RELAY_PID:-0}")
  if [ -n "$NEWEST_PY" ] && [ -n "$STARTED_AT" ] && [ "$NEWEST_PY" -gt "$STARTED_AT" ]; then
    say 提示 "dsb 源码比中继进程新——跑的是旧代码：kill $RELAY_PID 后重跑本脚本才生效"
  fi
else
  # initialize 不回话但端口有人占着 = 跑着旧代码的长驻中继（dsb 不重载
  # 代码，旧代码连 /mcp 路由都没有）。只提示、不擅自动：kill 会丢子进程
  # （mcp.json 里起着的 server 要重拉一遍）。
  RELAY_PID=$(lsof -nP -iTCP:$PORT -sTCP:LISTEN -t 2>/dev/null | head -1)
  if [ -n "$RELAY_PID" ]; then
    say 提示 "中继在跑（PID ${RELAY_PID}）却不答 initialize：跑的是旧代码"
    say 提示 "kill $RELAY_PID 后重跑本脚本才生效（会丢它起的子进程，需重拉一遍）"
    exit 1
  fi
  RELAY_JUST_STARTED=1
  nohup pnpm relay:dev >/tmp/dsb-relay.log 2>&1 &
  disown
  say 中继 "已起 → /tmp/dsb-relay.log"
fi

# ---- 3) 浏览器：只认独立 profile；装的扩展比构建旧就自动重启 ----
# 主进程的首个 flag 是 --user-data-dir，子进程是 --type=，据此只数主进程。
STARTED_BROWSER=0
BROWSER_MAIN=$(browser_main_pid)
if [ -n "$BROWSER_MAIN" ]; then
  # 装的扩展比构建旧 = 跑的旧代码（SW 脚本缓存在 profile 里，重启
  # 浏览器才会换新）。重启只动 ds-browser 这一个进程：登录态在
  # profile 里不丢，开着的标签页会关；用户的别的浏览器一律不碰。
  BROWSER_STARTED=$(proc_started "$BROWSER_MAIN")
  BUILD_MTIME=$(stat -f %m "$MV3/background.js" 2>/dev/null || echo 0)
  if [ -n "$BROWSER_STARTED" ] && [ "$BUILD_MTIME" -gt "$BROWSER_STARTED" ]; then
    say 提示 "浏览器装的扩展比构建旧（跑旧代码）：自动重启 ds-browser"
    kill "$BROWSER_MAIN" 2>/dev/null
    for _ in 1 2 3 4 5; do
      ps -p "$BROWSER_MAIN" >/dev/null 2>&1 || break
      sleep 1
    done
    kill -9 "$BROWSER_MAIN" 2>/dev/null
    start_browser
  else
    say 浏览器 "已在跑（独立 profile，扩展是新的）"
  fi
else
  start_browser
fi

# ---- 4) 判据 ----
# 扩展不再有外露的探针面（POST /action 与动作流随 ADR-0007 一起废了）：
# 本机这半直接验；扩展那一半靠 ping 日志（判据 4）+ 末尾的图标与控制台。
sleep 3

hello_out=$(rpc '{"jsonrpc":"2.0","id":"env-up","method":"initialize"}')
case "$hello_out" in
  *'"result"'*) say 判据1 "中继健康（initialize 回话）" ;;
  *) say 判据1 "中继不健康：$hello_out" ; exit 1 ;;
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

# 判据 4：扩展最后探活（信息项，不阻塞——总开关关着是常态）。
age=$(last_probe_age)
if [ "$age" = "-1" ]; then
  say 判据4 "扩展探活读不到（中继可能不是本脚本起的、日志在别处）"
elif [ "$age" = "-2" ]; then
  say 提示 "探活日志在但没有痕迹：扩展没探活（总开关关着是常态），或中继跑旧代码（不记 ping）"
elif [ "$age" -gt 90 ]; then
  say 提示 "扩展 ${age}s 没探活：总开关关着 / SW 死了 / 浏览器关了（关着是常态，不算故障）"
  if [ "$RELAY_JUST_STARTED" = 1 ]; then
    say 提示 "中继是本脚本刚起的：下一轮探活最多 30s 后到"
  fi
else
  say 判据4 "扩展探活新鲜（${age}s 前）：扩展活着且总开关开着"
fi

cat <<EOF

  扩展那一半：判据 4 已自动报最后探活距今；细粒度看这三处：
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

  本脚本幂等；重跑只会重启「装的扩展比构建旧」的 ds-browser
  （独立 profile，登录态不丢），不动任何别的浏览器。
EOF
