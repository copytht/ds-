## 开发方式

本项目**用自己的这套东西开发自己**：与用户会话的 agent 指挥**网页**（DeepSeek），网页再指挥
**子 agent**（opencode，经中继 `dsb`）。开发任务默认沿这条链走，不绕开它。

这条链**不少活都干得了**，别预设它干不了。只有当任务**确实超出它的能力**时，才由与用户会话的
agent 直接出手。

默认把子 agent 当成**小模型 / 能力弱**的模型：给它的指令要小、要具体、要能验证，别把开放式的大
目标整包丢过去。

与用户会话的 agent 只做两件事：**把目标和验收标准交给网页、把链子回来的结果原样喂回去**。
怎么拆、怎么排围栏、错了怎么修，让**网页**自己想——不替它读文档、不替它诊断、不逐步指派。

**代码由网页写，子 agent 只干杂活**：网页（强模型）产出代码 / 配置 / 文档；子 agent（弱模型）
只负责落地——写文件、跑命令、跑测试、把结果原样贴回来。别让子 agent 自己写代码。

## 浏览器边界

**禁止用用户的主浏览器 profile**：跑扩展 / 起浏览器一律走独立 `--user-data-dir` 的实例，
`--load-extension` 不得挂到主 profile 实例上，也不得改写主 profile 的扩展设置。

**用户正在用浏览器时不许重启它**（不 SIGTERM、不重开窗口）。要清 flag、换 profile、装扩展，
先问现在方不方便，或者让用户自己动手；动主 profile 必须用户明确点头，含糊点头不算。

## 环境准备

**跑 `scripts/env-up.sh`**，别现拼命令：它起缺的、**活的一律不重启**，末尾三条判据（中继健康 /
动作流有订阅者 / 有无会话标签页）。幂等，随时可重跑。

**动作探针别拿 `target: null` 打页面动作**：`page.state` / `composer.read` / `messages.*` /
`chat.new` 要先 `tabs.list` 拿标签页 id 再带上。`target: null` 只有 `tabs.list` 与 `toggle.*`
答得出，其余一律落 `src/lib/action.ts:172` 的 `unknown-action`——**那是探针错了，不是链子坏了**，
别照着它去修扩展。

登录 DeepSeek 与勾「替人开口」是人做的两件，脚本只打印不代劳；没勾闸则写动作回 `disabled`
属预期，不是故障。

## Agent skills

### Issue tracker

Issues live in GitHub Issues on `copytht/ds-`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical roles, label string = role name. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.
