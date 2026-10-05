# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-05
- Reviewer: OpenCode 会话（用户拍板风格与范围）
- Change: docs-into-openspec

## In-Force ADR Context Reviewed

- `adr/0002-outbound-through-a-single-gate.md - 出站口与 3~5 秒窗口；含三态状态机作废的补记，「唯一」说法已按 continuation 能力改窄`
- `adr/0004-failures-are-recorded-without-the-body.md - 失败只记事件不记正文；中继一行 stderr、扩展一条 storage`
- `adr/0010-say-why-the-page-is-unusable.md - 写作框不在时要报出账号处境（composer-absent + page.state.account）`
- `adr/0011-dsb-is-a-stateless-mcp-gateway.md - 唯一端点 POST /mcp、被动到底、无状态、不下发 CORS（其一句被 0012 局部修订，其余仍作数）`
- `adr/0012-dsb-ships-its-own-work-tools.md - 五件工作工具、root 钉死、不给 SHELL、拒写 .git/；本篇修订 0011 的一句`
- `adr/0013-local-tools-run-in-the-extension.md - 组合工具住扩展侧，sendCall 截获；本地工具不进页面动作名册`
- `adr/0014-continuation-through-the-request-body.md - 续聊走请求体替换，轮数有上限；已落成 continuation 能力的 8 条 requirement`
- `adr/0015-many-fences-in-one-answer.md - 一轮多块围栏、一趟一块、MAX_CALLS_PER_ROUND = 8；本 change 补成 backend requirement`
- `adr/0016-the-gateway-caps-what-it-hands-over.md - 结果 64K 字、单服务 128 件、三档超时；本 change 补成 backend requirement`

## Repository-Level ADRs Created

- `adr/0017-adrs-live-beside-openspec.md - ADR 落仓库根 adr/（与 openspec 平级）、换 spec-driven-with-adr schema、不可变靠 Supersedes 演进、spec 与 ADR 分工`

## Notes

- **0011 与 0012 是局部修订，不是整体取代**：0012 作废的只有 0011 里「dsb 自己一条工具都不编」
  一句，0011 其余（唯一端点、被动、无状态）仍有效。故两篇的 `Supersedes` 都写 `none`——
  把 0011 整篇标成 not-in-force 会丢掉仍然生效的约束。关系记在此处与 0012 正文。
- **未新开「文档搬家」类的更多 ADR**：docs/ 拆分、page-actions 并入 spec、agents 三篇并入
  AGENTS.md 都是归位，不是新决策；唯一的长期承诺已由 0017 记下。
- **丢掉一段死内容**：`docs/agents/issue-tracker.md` 里的「Wayfinding operations」七条
  指向 `/wayfinder` 技能，而本仓（含全局 `~/.config/opencode` 与 `~/.agents/skills`）没有
  该技能，`domain.md` 里的 `/domain-modeling`、`/grill-with-docs`、`/improve-codebase-architecture`
  同样不存在——**并入 AGENTS.md 时未搬运**。理由：没有消费者的指引是死引用，清死代码那次
  （PR #57）的口径一致。若将来装回这些技能，从 git 历史取回即可。
