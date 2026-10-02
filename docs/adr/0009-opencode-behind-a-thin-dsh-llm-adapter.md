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

自写一个薄 `LlmAdapter`（约 80 行），注册一条 provider 路由，`stream()` 里每轮 spawn 一次
`opencode run --model opencode/big-pickle --cwd <dir>`，把 stdout 当答案吐成
`block-start` / `text-delta` / `block-end` / `finish` 四个 chunk。

多轮不由接缝负责：dsh 的 continuation 每轮调一次 `stream()`，历史留在 dsh Session 里，所以
「一问一进程」在这里是合身而非缺陷——请求本来就该无状态。工具同理，全在 opencode 内部跑完
（bash、测试、贴回原始输出），dsh 侧不吐 `tool-call-delta`。

## Consequences

- **不碰 vendor 包**：dsh 与 cordis 全部按原样挂载，新增代码只有这一个适配器。
- **每轮一次进程启动**（约 1–3s）。比直连 `/api` 的常驻 session 慢，但省掉了 session 复用、
  认证和 401 处理三块代码。
- **非流式**：一轮跑完才回答案，扩展侧看不到中间过程。真要流式得改 `opencode run` 的事件
  解析，是后一步。
- **只回文本**：模型自陈失败时以非零退出码和 stderr 暴露；dsh 侧拿到的是一个短答案而不是
  结构化错误。
- 这个接缝换来的正是被砍掉的东西：dsh 的 continuable 多轮、interrupt、descriptor 持久化
  不再由 `dsb/client.py` 手写维护。
