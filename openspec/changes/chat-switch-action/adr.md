# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-07
- Reviewer: 与用户会话的 agent
- Change: chat-switch-action

## In-Force ADR Context Reviewed

- adr/0018-keep-original-button-code-and-image.md - 存证已满足（`sidebar.chat-row`），回归用例原件取自存证、不手抄
- adr/0013-local-tools-run-in-the-extension.md - 本地工具名册与页面动作名册是两套；`chat.switch` 属页面动作名册
- adr/0011-dsb-is-a-stateless-mcp-gateway.md - 页面动作没有外露调用面，真机验走探针
- adr/0002-outbound-through-a-single-gate.md - 出站只收「自动续聊」那一路；`chat.switch` 不发消息，不经出站口
- adr/0004-failures-are-recorded-without-the-body.md - 失败只记码与环节，不记正文；本动作只用现成失败码
- adr/0017-adrs-live-beside-openspec.md - 必须怎样进 spec、理由进 ADR；本篇无新 ADR

其余 ADR（0010 / 0012 / 0014 / 0015 / 0016）与会话切换无交集，已读过。无被取代的篇目。

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

「歧义时拒绝、不替人选」「不回读、核实交给 `page.state`」是这个动作的战术取舍，已写进 design；
若以后别的动作（如 #66 B 的按索引取第几条消息）也采用同一口径，再提升成 ADR。
