# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-07
- Reviewer: 与用户会话的 agent
- Change: chat-switch

## In-Force ADR Context Reviewed

- adr/0018-keep-original-button-code-and-image.md - 登记最小单元须原样存证；本 change 的 `sidebar.chat-row` 依据它
- adr/0017-adrs-live-beside-openspec.md - 理由进 ADR、必须怎样进 spec；本篇无新 ADR
- adr/0014-continuation-through-the-request-body.md - 续聊的请求体替换口径；`chat.switch` 与它同属「一轮里换上下文」，实现阶段要对齐
- adr/0013-local-tools-run-in-the-extension.md - 本地工具住扩展侧；切换会话是扩展侧动作，不涉及 dsb

其余 ADR（0002 / 0004 / 0010 / 0011 / 0012 / 0015 / 0016）与候补登记无交集，已读过。无被取代的篇目。

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

存证字段与 `state-bound` 的口径由 `adr-0018-evidence` 的 design 定，本篇沿用，不另立决策。
