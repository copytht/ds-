# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-05
- Reviewer: OpenCode 会话（本会话 agent 实施，判据与取舍见 design.md）
- Change: messages-list-pick-right-list

## In-Force ADR Context Reviewed

- `adr/0002-outbound-through-a-single-gate.md - 出站口与 3~5 秒窗口；与读 DOM 那条路无关，本次不动出站`
- `adr/0004-failures-are-recorded-without-the-body.md - 失败只记事件不记正文；本次仍只出在册失败码（`page-changed`），不新增`
- `adr/0010-say-why-the-page-is-unusable.md - 停机要说得出来；本次「认不出对话列表 → 当场 page-changed」与它同向（不空等、不猜）`
- `adr/0011-dsb-is-a-stateless-mcp-gateway.md - 唯一端点 POST /mcp、被动到底、无状态（其一句被 0012 局部修订，其余仍作数）`
- `adr/0012-dsb-ships-its-own-work-tools.md - 五件工作工具、root 钉死、不给 SHELL；本篇修订 0011 的一句`
- `adr/0013-local-tools-run-in-the-extension.md - 组合工具住扩展侧，本地工具名册 v1 = send.page；本次不改名册`
- `adr/0014-continuation-through-the-request-body.md - 续聊走请求体替换、轮数上限；与读消息列表正交`
- `adr/0015-many-fences-in-one-answer.md - 一轮多块围栏、一趟一块；围栏还原路径本次不改`
- `adr/0016-the-gateway-caps-what-it-hands-over.md - 结果 64K 字、单服务 128 件、三档超时；`messages.list` 的结果上限口径不受影响`
- `adr/0017-adrs-live-beside-openspec.md - ADR 落仓库根 adr/、不可变靠 Supersedes 演进、spec 与 ADR 分工；本 manifest 即按它走`

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

- **为什么不新开 ADR**：本 change 的两个决定——①多虚拟列表里按「写作框 → `--printable` →
  `.ds-message`」挑对话那一条、②行没 key 时用正文当身份——都是**读站点 DOM 的锚点与身份口径**，
  归 `site-dom` spec（ADR-0017 定的分工：可被验收的「必须怎样」进 spec，长期架构承诺才进 ADR）。
  没有跨能力的边界 / 协议 / 技术选型变化，也没推翻任何 in-force ADR。
- **票里的一处口径要改**：#54 建议 C 的前提是「`sweepInto` 不因 key 缺而弃行」，与代码相反
  （`src/lib/messages.ts:412` 是 `if (key === null || seen.has(key)) continue;`）——
  真相是**恰恰因为它丢，才一行都收不进**。落 spec 时按代码现状写，不按票的描述写。
- **#37 是第二层的来处**：f1c6638（2026-10-04）给 `wait.*` 加了结构行锚与「无 key 行正文集合」，
  同一次提交没动 `messages.ts` 的收集路径，两处自此对不上。这次把口径收成一条。
