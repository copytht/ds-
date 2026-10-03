# Spec: channel

## Purpose

SSE 下行通道：中继把待执行的页面动作推给扩展（动作流），总开关开着才订阅，动作按标签页串行（ADR-0007）。

## Requirements
- 动作流订阅仅在总开关开时生效
- 动作按标签页串行，不打架
- 失败码 `backing-off` / `disabled` / `page-changed` / `tab-gone` / `read-failed` / `composer-absent` 在册
