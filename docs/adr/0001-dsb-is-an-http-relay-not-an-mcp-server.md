# dsb 是本机 HTTP 中继，不是 MCP 服务

仓库最初的口径是「uv 管一个 MCP 进程」，实测证明这条路在本项目的形态下走不通：**不使用工具**时，opencode 作为 MCP client 只会主动发发现类请求（`tools/list`、`prompts/list`、`resources/list`），没有一条能携带自由文本；而 server 侧向 client 投递消息的两种原语——`elicitation/create` 发出后 40 秒无响应，`sampling/createMessage` 被 `-32601 Method not found` 拒绝，`notifications/*` 观察不到任何进入会话的迹象。于是决定：`dsb` 落成本机 HTTP 服务（`uv run dsb`），扩展打它，它调 opencode 的 HTTP API；"MCP" 这个名分放弃。

## Considered Options

- **MCP server（原口径）**：名分与生态都在，但双向都没有可用通道；要通只能恢复"给 agent 提供工具"，与「不使用工具」的定案直接冲突。
- **扩展直连 opencode，不要 dsb**：省一层，但口令与随机端口的持有、超时、把"opencode 没起"翻译成一条可识别的错误，都需要一个本机落点；扩展的 service worker 也 spawn 不了进程。
- **两套协议并存**（MCP 对 opencode、HTTP 对扩展）：为保留名分养一套没人用的协议。

## Consequences

- `dsb` 不进 opencode 的 `mcp` 配置；`opencode.json` 里没有它。
- 端口与口令由 dsb 每次启动时 `opencode service status` / `opencode service get password` 现读，不落盘。
- 本机要求 opencode 后台服务在跑；不在跑时 dsb 返回可识别的错误，扩展在**扩展侧**提示，不进对话流。

依据：本机 opencode v2.0.18 实测（`/tmp/mcp_probe.py` 抓包、`/tmp/oc-openapi.json`），2026-09-28。
