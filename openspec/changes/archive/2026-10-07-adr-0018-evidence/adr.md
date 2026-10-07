# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-07
- Reviewer: 与用户会话的 agent
- Change: adr-0018-evidence

## In-Force ADR Context Reviewed

- adr/0017-adrs-live-beside-openspec.md - spec 承载「必须怎样」、CI 守；ADR 承载「为什么」（本 change 把 ADR-0018 落成 spec requirement）
- adr/0018-keep-original-button-code-and-image.md - 本 change 的直接依据：原样保留按钮的代码与图片，测试检查符合原样，两处逐字比
- adr/0011-dsb-is-a-stateless-mcp-gateway.md - 页面动作没有外露调用面，真机验走探针（本 change 的对账子命令属探针）
- adr/0004-failures-are-recorded-without-the-body.md - 对账失败只报 id 与差异片段，与「留痕不带正文」不冲突（存证是 DOM 不是用户正文）

其余 ADR（0002 / 0010 / 0012 / 0013 / 0014 / 0015 / 0016）与存证、对账无交集，已读过。无被取代的篇目。

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

存证文件位置（`protocol/evidence/`）与对账判据属于 ADR-0018 Follow-up 里明说「由那个 change 的 design 定」的落点，
是战术选择，不构成新的长期架构承诺。
