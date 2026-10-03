# Spec: message

## Purpose

对话读取与消息流：扩展读页面对话内容，判断新消息是否为基线后消息（`wait.fence` / `wait.reply`，#22）。

## Requirements
- `messages.list` / `messages.last` 读已知消息
- 只算基线之后的新消息为答复，不重复计算旧消息
