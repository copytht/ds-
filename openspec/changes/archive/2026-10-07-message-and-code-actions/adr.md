# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-07
- Reviewer: 与用户会话的 agent
- Change: message-and-code-actions

## In-Force ADR Context Reviewed

- adr/0018-keep-original-button-code-and-image.md - 本 change 的前置：8 个动作的存证先行入档，回归用例读存证不手抄；同形六颗按钮正是它点名的情形
- adr/0011-dsb-is-a-stateless-mcp-gateway.md - 页面动作没有外露调用面，真机验走探针（`page-action.py`）
- adr/0013-local-tools-run-in-the-extension.md - 页面动作名册与本地工具名册是两套；这 8 个属页面动作名册
- adr/0002-outbound-through-a-single-gate.md - 出站只收「自动续聊」；`message.retry` 不经出站口，但按「代你发言」闸处理
- adr/0004-failures-are-recorded-without-the-body.md - 失败只记码与环节；本 change 只用现成失败码
- adr/0017-adrs-live-beside-openspec.md - 必须怎样进 spec、理由进 ADR；本篇无新 ADR

其余 ADR（0010 / 0012 / 0014 / 0015 / 0016）与消息工具栏、代码块动作无交集，已读过。无被取代的篇目。

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

`index` 的「挂载集合内位置 + 负数从末尾数」与「工具栏结构双重校验」是这批动作的战术口径，已写进 design。
若以后更多「按位置取第 N 个同形控件」的动作都采用同一口径，再提升成 ADR。
