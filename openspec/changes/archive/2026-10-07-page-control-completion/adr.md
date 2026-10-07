# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-06
- Reviewer: OpenCode 会话（本会话 agent 实施）
- Change: page-control-completion

## In-Force ADR Context Reviewed

- `adr/0002-outbound-through-a-single-gate.md` - 出站口与 3~5 秒窗口；本次不动出站
- `adr/0004-failures-are-recorded-without-the-body.md` - 失败只记事件不记正文；本次仅改 spec 文字
- `adr/0010-say-why-the-page-is-unusable.md` - 停机要说得出来；候补定位升级后找不到仍回 `page-changed`
- `adr/0011-dsb-is-a-stateless-mcp-gateway.md` - 唯一端点 POST /mcp、被动到底、无状态
- `adr/0012-dsb-ships-its-own-work-tools.md` - 五件工作工具、root 钉死、不给 SHELL
- `adr/0013-local-tools-run-in-the-extension.md` - 组合工具住扩展侧，本地工具名册 v1 = send.page；候补不进名册
- `adr/0014-continuation-through-the-request-body.md` - 续聊走请求体替换、轮数上限；与候补登记正交
- `adr/0015-many-fences-in-one-answer.md` - 一轮多块围栏、一趟一块；候补不涉及围栏
- `adr/0016-the-gateway-caps-what-it-hands-over.md` - 结果 64K 字、单服务 128 件、三档超时
- `adr/0017-adrs-live-beside-openspec.md` - ADR 落仓库根 adr/、不可变靠 Supersedes 演进、spec 与 ADR 分工
- `adr/0018-keep-original-button-code-and-image.md` - 制作最小单元必须原样保留按钮的代码与图片、测试必须检查符合原样；本 change 的候补升级为后续实现（需满足 ADR-0018 的存证对拍）铺路

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change. 本 change 仅做 spec 文字升级（候补定位从「待真机确认」→真机实测、待查项结掉、v1 名册边界显式），不引入新的架构承诺。ADR-0018 已在 #63 独立合并，本 change 在 Follow-up 中引用它。

## Notes

本 change 严格限定为「只改 spec 文字」：`openspec/specs/frontend/spec.md` 的候补 requirement（`页面动作的候补控件只登记、不进名册`）做 MODIFIED。不改代码、不改契约、不改 site-dom、不加测试。候补项的真正实现（进名册、四处对齐、真机存证对拍）另开 change，需先满足 ADR-0018 的要求。
