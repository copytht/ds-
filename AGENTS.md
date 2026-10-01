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

## Agent skills

### Issue tracker

Issues live in GitHub Issues on `copytht/ds-`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical roles, label string = role name. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.
