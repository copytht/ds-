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
EXT_ID=lebhdfhpogojdocfeicgaffejombnmfl   # 由 MV3 路径算出，路径不变就恒定

say() { printf '  %-8s %s\n' "$1" "$2"; }

# ---- 1) 扩展构建：源码比产物新才重建（老产物 = 名册缺动作 = 一串 unknown-action）----
if [ ! -f "$MV3/background.js" ]; then
  pnpm build >/tmp/dsb-build.log 2>&1 && say 构建 "缺产物，已重建" || { say 构建 "重建失败 → /tmp/dsb-build.log"; exit 1; }
elif [ -n "$(find src entrypoints -name '*.ts' -newer "$MV3/background.js" 2>/dev/null | head -1)" ]; then
  pnpm build >/tmp/dsb-build.log 2>&1 && say 构建 "源码较新，已重建" || { say 构建 "重建失败 → /tmp/dsb-build.log"; exit 1; }
else
  say 构建 "产物最新"
fi

# ---- 2) 中继 ----
if curl -sf -m 3 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
  say 中继 "已在跑"
else
  nohup pnpm relay:dev >/tmp/dsb-relay.log 2>&1 &
  disown
  say 中继 "已起 → /tmp/dsb-relay.log"
fi

# ---- 3) 宿主 ----
if pgrep -f 'native/host\.mjs' >/dev/null 2>&1; then
  say 宿主 "已在跑"
else
  nohup node native/host.mjs >/tmp/dsb-host.log 2>&1 &
  disown
  say 宿主 "已起 → /tmp/dsb-host.log"
fi

# ---- 4) 浏览器：只认独立 profile；已活着绝不重启（重启 = 掉 --load-extension）----
# 主进程的首个 flag 是 --user-data-dir，子进程是 --type=，据此只数主进程。
if ps ax -o command= | grep -E '^/Applications/Chromium\.app/Contents/MacOS/Chromium --user-data-dir=.*ds-browser' >/dev/null 2>&1; then
  say 浏览器 "已在跑（独立 profile）"
else
  "$CHROME" --user-data-dir="$PROFILE" --load-extension="$MV3" \
    --no-first-run --no-default-browser-check >/tmp/dsb-browser.log 2>&1 &
  disown
  say 浏览器 "已起 → 独立 profile"
fi

# ---- 5) 判据：中继健康 + 动作流有订阅者 ----
sleep 3
TOKEN=$(cat .dsb-token 2>/dev/null || true)
probe() {
  curl -s -m 10 -X POST "http://127.0.0.1:$PORT/action" \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "$1"
}

echo
health=$(curl -s -m 5 "http://127.0.0.1:$PORT/health" 2>/dev/null)
case "$health" in
  *'"ok"'*|*'status": "ok"'*) say 判据1 "中继健康 $health" ;;
  *) say 判据1 "中继不健康：$health" ; exit 1 ;;
esac

t=$(probe '{"action":"toggle.get","params":{},"target":null}')
case "$t" in
  *'"ok": true'*) say 判据2 "扩展已连上（动作流通了）" ;;
  *no-subscriber*) say 判据2 "扩展没连上：多半是 --load-extension 掉了 → 重启本脚本" ; exit 1 ;;
  *) say 判据2 "探针异常：$t" ; exit 1 ;;
esac

# ---- 5) 会话标签页：没有就开一个（同 profile 二次调用 → 转给已在跑的实例，**不重启**）----
tabs_now=$(probe '{"action":"tabs.list","params":{},"target":null}')
case "$tabs_now" in
  *'"tabs": []'*)
    "$CHROME" --user-data-dir="$PROFILE" --no-first-run \
      "https://chat.deepseek.com/" >/tmp/dsb-open.log 2>&1
    sleep 2
    say 会话页 "已开 chat.deepseek.com（转给在跑的实例）"
    ;;
  *) say 会话页 "已有" ;;
esac

tabs=$(probe '{"action":"tabs.list","params":{},"target":null}')
case "$tabs" in
  *'"tabs": []'*) say 判据3 "标签页没出来 → /tmp/dsb-open.log" ; exit 1 ;;
  *) say 判据3 "有会话标签页，可直接带 target 打动作" ;;
esac

cat <<EOF

  别再用 target:null 打页面动作：
    page.state / composer.read / messages.* / chat.new 需要 target=标签页 id，
    先 tabs.list 拿 id。target:null 只有 tabs.list 和 toggle.* 答得出，其余落
    src/lib/action.ts:172 的 unknown-action——那是探针错了，不是链子坏了。

  人做的两件（**都只第一次**，之后永久生效）：
    1. 登录 DeepSeek —— 标签页脚本已开好，只差登录
    2. 勾「替人开口」 —— 地址栏 chrome-extension://$EXT_ID/options.html
       这一步故意没有动作口（agent 不能自授发言权，围栏别拆）；
       不勾则 composer.type / send.* 回 disabled，属预期不是故障

  本脚本幂等：环境没坏就别重跑，重跑也不会动活着的浏览器。
EOF
