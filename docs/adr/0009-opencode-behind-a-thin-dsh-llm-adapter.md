# opencode 作后端：接缝落在自写的 LlmAdapter，不落在 ACP

目标是把 dsh 的 subagent 包引进来替掉 `dsb/client.py` 手写的会话编排。dsh 那边的编排已经齐了
（`continuation.ts`：stable child id + descriptor 持久化 + 冷恢复，Agent inbox 当唯一 turn 队列），
缺的只是一个能把 dsh 的模型请求送到 opencode 的接缝。三个现成接缝都实测走不通：

| 接缝                                | 实测结果                                                                                                                                                                                                                                                                      |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dsh-subagent-acp` + `opencode acp` | ACP 私有服务的模型目录恒为 `deepseek/deepseek-v4-pro` 与 `deepseek/deepseek-flash`；`session/set_config_option` 钉 `opencode/big-pickle` 被服务端判 `model not found: opencode/big-pickle`                                                                                    |
| 给 `opencode acp` 注入配置          | project `opencode.json`（含 `model`、`disabled_providers`）、`OPENCODE_CONFIG`、`OPENCODE_CONFIG_CONTENT` 全部无效：`session/new` 的 `currentValue` 不动，`disabled_providers` 连 deepseek 都没禁掉。ACP 会话的模型集与同 cwd 的普通 `opencode serve` 不一致，且不读 cwd 配置 |
| `dsh-llm-pi-ai` 指向 opencode       | opencode v2 的 HTTP 面只有 `/api/*`，没有 OpenAI 兼容端点：`/v1/chat/completions`、`/v1/responses`、`/v1/messages` 一律 405                                                                                                                                                   |

DeepSeek 那两个模型余额为零，所以 ACP 这条路在充值之前实际不可用。决定自己写那层接缝。

## 决定

自写一个薄 `LlmAdapter`（约 90 行），注册一条 provider 路由，`stream()` 里每轮 spawn 一次
`opencode run --format json --auto --model opencode/big-pickle`，把它吐的 NDJSON 事件流翻成
dsh 的 `block-start` / `text-delta` / `block-end` / `finish`。`--auto` 等价于旧链路的
`permission: allow`（子 agent 要自己跑 bash 与测试，过不了权限门就是干等）。opencode 反复推送
同一个 part 的累积文本，只把多出来的尾巴发下去。

多轮不由接缝负责：dsh 的 continuation 每轮调一次 `stream()`，历史留在 dsh Session 里，所以
「一问一进程」在这里是合身而非缺陷——请求本来就该无状态。工具同理，全在 opencode 内部跑完
（bash、测试、贴回原始输出），dsh 侧不吐 `tool-call-delta`。

## host 怎么拿到一个能授权的 parent

continuable child 的每一轮投递都要经过「exact live direct parent」，缺了它就是
`subagent/parent-unavailable`。一开始以为这意味着 host 必须跑一整套 AgentLoop，代价是每问多
一次模型调用。实际不是：`Agent` 的公开形状只有 `readonly id: SessionId`，`AgentRegistry.register()`
收的就是它。于是 parent 是一个按网页会话 id 缓存的鸭子类型，注册一次即可。

三条 host 侧调用的确切形状：

| 用途              | 调用                                                                                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 建 child 并投首问 | `ctx.subagents.startContinuable({ provider, label, request, signal })` → `{ childId, messageId }`                                                                   |
| 续问              | `ctx.subagents.prompt({ parentSessionId, childSessionId, mode: 'continuable', delivery: 'queue' \| 'steer', content, requestId }, signal)` —— 纯数据，无 Agent 对象 |
| 中断              | `ctx.subagents.interrupt(childId, { kind: 'user', parentSessionId })`                                                                                               |

`interrupt` 与 `prompt` 都认「人类经 parent 地址投递」这一路，`sendMessage` 那条要求活 `Agent`
sender 的路是给模型间消息用的，host 不用碰。

## Consequences

- **不碰 vendor 包**：dsh 与 cordis 全部按原样挂载，新增代码只有这一个适配器。
- **每轮一次进程启动，实测约 12 秒**（big-pickle 回三个字 12.3s）。比直连 `/api` 的常驻
  session 慢，但省掉了 session 复用、认证和 401 处理三块代码。
- **流式**：答案按 NDJSON 到达即转发，扩展侧不必等整轮跑完。
- **只回文本**：模型自陈失败时以非零退出码和 stderr 暴露；dsh 侧拿到的是一个短答案而不是
  结构化错误。
- **每轮重发全历史**：请求无状态，历史靠渲染进 prompt 传过去，token 成本随对话变长而涨。
- 这个接缝换来的正是被砍掉的东西：dsh 的 continuable 多轮、interrupt、descriptor 持久化
  不再由 `dsb/client.py` 手写维护。
