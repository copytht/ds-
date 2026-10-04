## 开发方式

**与用户会话的 agent 直接实施**（2026-10-03 起，用户点头）：代码、配置、文档、
测试都由它写。链子（网页 → 子 agent）**回来后再用，但不等它**——网页被禁言
（账号在站点处罚区）时整条链是断的，等它就干瞪眼。

链子能用的活（问第二双眼、跑大段读 legwork）仍走链子，不绕开它；链子断的活
（禁言期间的全部）由与用户会话的 agent 直接做。

默认把子 agent 当成**小模型 / 能力弱**的模型：给它的指令要小、要具体、要能验证，别把开放式的大
目标整包丢过去。

与用户会话的 agent 只做两件事：**把目标和验收标准交给网页、把链子回来的结果原样喂回去**。
怎么拆、怎么排围栏、错了怎么修，让**网页**自己想——不替它读文档、不替它诊断、不逐步指派。

## 浏览器边界

**禁止用用户的主浏览器 profile**：跑扩展 / 起浏览器一律走独立 `--user-data-dir` 的实例，
`--load-extension` 不得挂到主 profile 实例上，也不得改写主 profile 的扩展设置。

**用户正在用浏览器时不许重启它**（不 SIGTERM、不重开窗口）。要清 flag、换 profile、装扩展，
先问现在方不方便，或者让用户自己动手；动主 profile 必须用户明确点头，含糊点头不算。

**例外（2026-10-04 用户拍板）**：**ds-browser**（独立 profile 那个）这套动作不用先问、直接做：
`scripts/env-up.sh` 检测到它装的扩展比构建旧会自动重启它（SIGTERM 主进程 → 清 SW 脚本缓存 →
重装扩展 → 开会话页）；要带调试口跑真机探针（`scripts/page-action.py`）时，按 `--debug`
重启它也一样。登录态在 profile 里不丢、开着的标签页会关。**除此之外的浏览器一律不动**
（主 profile、别人在用的），要动仍先问。

## 环境准备

**跑 `scripts/env-up.sh`**，别现拼命令：它起缺的、**旧代码自动换**（ds-browser 装的扩展
比构建旧会自动重启；中继跑旧代码提示 kill），末尾判据（中继自检健康 /
`tools/list` 取得到工具表 / 扩展最后探活新鲜 / 会话标签页——env-up 起或重启浏览器时
**清掉会话恢复、直接带 `chat.deepseek.com` 当首个标签页**（旧标签页与空白新标签页都不会
回来）；浏览器是先前就起着的，env-up 不代开、只报）。幂等，随时可重跑；`--status` 只读汇总、
`--debug` 带调试口起（开发探针用）。

**动作探针别拿 `target: null` 打页面动作**：`page.state` / `composer.read` / `messages.*` /
`chat.new` 要先 `tabs.list` 拿标签页 id 再带上。`target: null` 只有 `tabs.list` 与 `toggle.*`
答得出，其余一律落 `src/lib/action.ts` 的 `unknown-action`（`ACTION_ERROR_UNKNOWN`）——
**那是探针错了，不是链子坏了**，别照着它去修扩展。

登录 DeepSeek 与勾「替人开口」是人做的两件，脚本只打印不代劳；没勾闸则写动作回 `disabled`
属预期，不是故障。

dsb 内建五件工作工具（`ls` / `read` / `grep` / `write` / `edit`），钉死在工作文件夹 root 内；
`DSB_WORK_ROOT` 改 root（缺省本仓根），改完重启中继才生效。不给命令执行。

**动作失败码分得开，别再让它们混成一个**：写动作撞禁言/未登录回 `composer-absent`
（配 `page.state` 的 `account` 读得清是哪一种），页面上找不到认得的东西回
`page-changed`，读不完回 `read-failed`；只有这一跳真的走不通才是 `tab-gone`。执行器要
抛带码的 `PageError`，收信那层（`channel.ts` 的 `failureCode`）才认。

## 脚本

**所有脚本放 `scripts/`、按可复用写**：一件事一个工具、参数化；别写一次性 `/tmp` 脚本，
更别把脚本贴进对话就算完。要临时读页面 / 发页面动作 / 跑表达式 / 读写扩展 storage，
走已有工具的入口（`scripts/page-action.py` 的 `read` / `send` / `js` / `stop-test` /
`storage`），别另起一个。
脚本改动同样过 `pnpm quality`（ruff 会扫 `scripts/`）。

## Agent skills

### Issue tracker

Issues live in GitHub Issues on `copytht/ds-`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical roles, label string = role name. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.
