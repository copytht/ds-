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

# 总开关关着时，判据 3/4 读不了 —— action.ts:143 是总开关管一切、toggle.* 除外，
# tabs.list 也在内。而开它就等于把页面世界的 fetch/XHR 钩子装上（inject.content.ts:209），
# 那是 issue #31 那条。这笔账摆出来，开不开由人定。
case "$t" in
  *'"enabled": true'*) ;;
  *)
    say 提示 "总开关关着 → 判据 3/4 跳过（tabs.list 与 page.state 都会回 disabled）"
    say 提示 "开它 = 装上页面世界的 fetch/XHR 钩子（#31）；要开说一声，一条命令的事"
    exit 0
    ;;
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
# JSON 里冒号后有空格（python 出的），模式必须留空，否则抠出空串 → target="" → tab-gone
tab_id=$(printf '%s' "$tabs" | sed -n 's/.*"id":[[:space:]]*\([0-9]\{1,\}\).*/\1/p')
# 抠空了就响着退出：静默的空串会变成 target=""，下游只回 tab-gone，看不出是哪一步坏了
[ -n "$tab_id" ] || { say 判据3 "从 tabs.list 抠不出标签页 id：$tabs" ; exit 1; }
case "$tabs" in
  *'"tabs": []'*) say 判据3 "标签页没出来 → /tmp/dsb-open.log" ; exit 1 ;;
  *) say 判据3 "有会话标签页 id=${tab_id}，可直接带 target 打动作" ;;
esac

# 判据4：**能不能开工** —— 写作框在不在；不在的话扩展现在能说清是禁言还是没登录
state=$(probe "{\"action\":\"page.state\",\"params\":{},\"target\":\"$tab_id\"}")
case "$state" in
  *'"composerPresent": true'*) say 判据4 "写作框在，能写能发" ;;
  *'"kind": "muted"'*)
    until=$(printf '%s' "$state" | sed -n 's/.*"until": *"\([^"]*\)".*/\1/p')
    if [ -n "$until" ]; then
      say 判据4 "**账号禁言至 ${until}** —— 站点不渲染写作框，写动作全部无效"
    else
      say 判据4 "**账号禁言**（站点没写解封时刻）—— 写作框不渲染，写动作全部无效"
    fi
    say 判据4 "禁言是账号在站点的处罚，不是扩展坏了，也别去修选择器"
    say 判据4 "读类动作仍可用：messages.* / page.state / composer.read 都通"
    ;;
  *'"kind": "signed-out"'*)
    say 判据4 "**未登录** —— 站点把人导到了登录页"
    say 判据4 "登录在**独立 profile** 这个窗口里做（跟主浏览器两套登录态）"
    ;;
  *'"composerPresent": false'*)
    say 判据4 "无写作框，扩展也没认出处境（account=unknown）—— 页面结构变了，报给人"
    say 判据4 "读类动作仍可用，写类一律会失败"
    ;;
  *) say 判据4 "读不到页面状态：$state"
    say 判据4 "若是 disabled —— 总开关关着。判据 4 要读 DOM 就得开它，而开它同时"
    say 判据4 "会把页面世界的 fetch/XHR 钩子装上（issue #31 那条）。开不开你定。"
    ;;
esac

cat <<EOF

  别再用 target:null 打页面动作：
    page.state / composer.read / messages.* / chat.new 需要 target=标签页 id，
    先 tabs.list 拿 id。target:null 只有 tabs.list 和 toggle.* 答得出，其余落
    src/lib/action.ts:172 的 unknown-action——那是探针错了，不是链子坏了。

  人做的（只第一次，之后永久生效）：
    登录 DeepSeek 与勾「替人开口」都在**独立 profile** 这个窗口里做（跟主浏览器
    两套登录态）。勾「替人开口」那一步故意没有动作口（agent 不能自授发言权，
    围栏别拆）；不勾则 composer.type / send.* 回 disabled，属预期不是故障。

  查某动作为什么失败，两步就够（不用再往产物里塞诊断表）：
    1. page.state 的 account 说清处境 —— muted(带解封时刻) / signed-out / unknown
    2. 失败码本身就说清是哪一步 —— composer-absent(没有写作框) / page-changed
       (页面上找不到认得的东西) / read-failed(读不完) / tab-gone(这一跳走不通)

  账号被禁言时（站点橙框「禁言至 …」，写作框不渲染）整条交流线是断的：
  那是账号在站点的处罚，不是扩展坏了。别去修选择器，那修不好；等解封。

  本脚本幂等：环境没坏就别重跑，重跑也不会动活着的浏览器。
EOF
