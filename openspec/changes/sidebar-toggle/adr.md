# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-07
- Reviewer: 与用户会话的 agent
- Change: sidebar-toggle

## In-Force ADR Context Reviewed

- adr/0018-keep-original-button-code-and-image.md - 本 change 的前置：两态顶栏与开关键先存证，用例读存证不手抄；开关键无任何语义属性正是它点名的情形
- adr/0011-dsb-is-a-stateless-mcp-gateway.md - 页面动作无外露调用面，真机验走探针
- adr/0004-failures-are-recorded-without-the-body.md - 只用现成失败码，不改失败记录
- adr/0017-adrs-live-beside-openspec.md - 必须怎样进 spec、理由进 ADR；本篇无新 ADR

其余 ADR 与侧栏开关无交集，已读过。无被取代的篇目。

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

「数量 + 位置」（顶栏组 = 第一颗图标键的父元素）的校验与消息工具栏的「恰好 6 颗 + 朗读在第 5 位」同属一类战术口径：身份只靠位置时，
用结构不变量把「点错」变成「停下」。两处都采用后若还有第三处，再提升成 ADR。
