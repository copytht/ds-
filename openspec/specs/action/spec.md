# Spec: action

## Purpose

页面动作执行：agent 侧要页面做的一件最小事（点发送、读对话、等回灌），单件、由扩展在页面里执行（ADR-0007）。

## Requirements

- 单件动作入队列，按标签页串行执行
- 动作类型：`composer.type` / `composer.clear` / `send.click` / `send.enter` / `chat.new` / `tabs.list` / `page.state` / `messages.*`
- 结果通过 `channel.ts` SSE 下行返回
