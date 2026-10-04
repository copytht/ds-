# 状态与消息

## `storage.local`：重启丢不了的才进去

service worker 随时被浏览器收走，所以要跨重启的状态一律落 `storage.local`，键只以各模块导出的常量引用，
别处不许手写字符串字面量：

| 键 | 常量（出处） | 含义 |
| --- | --- | --- |
| `toggle` | `TOGGLE_STORAGE_KEY`（`src/lib/toggle.ts`） | 总开关，**缺键即关**，从不写默认值 |
| `speak` | `SPEAK_STORAGE_KEY`（同上） | 替人开口 |
| `backoffUntil` | `BACKOFF_STORAGE_KEY`（`src/lib/backoff.ts`） | 退避截止时刻 |
| `ds-/asks` | `ASKS_STORAGE_KEY`（`src/lib/ask.ts`） | 待回问句，按页面会话分表 |
| `ds-/failures` | `FAILURE_LOG_STORAGE_KEY`（`src/lib/failurelog.ts`） | 失败留痕 |
| `ds-/watchdog` | `WATCHDOG_CONFIG_STORAGE_KEY`（`src/lib/watchdog.ts`） | 看门狗配置覆写 |

不进 storage 的状态只有一种：**可随时重建的在途态**——现在只有 `inFlight`（有没有工具调用在途，
驱动角标），不做事无轮询的现场轮询。

## 三路消息，一条都不混

1. **chain（MAIN ↔ 隔离世界）**：`postMessage`，`kind` 判别：`call` / `result` / `ask` / `ask-cleared` /
   `said` / `tools`，`source` 固定 `ds-/chain`。构造函数与解析函数都住在 `src/lib/channel.ts`
   （`*Message()` 构造、`parse*` 解析），两头都从这里拿，别处不手搓信封。
2. **runtime（content ↔ background）**：消息类型常量也在 `channel.ts`——`ds-/send`、`ds-/tools`、
   `ds-/said`、`ds-/ask`、`ds-/account` 等。
3. **background ↔ 中继**：`POST /mcp` JSON-RPC，唯一客户端是 `src/lib/relay.ts`，只被 background 调。

## 反模式

- 在页面侧或隔离世界里存指望跨重启的状态。
- 新增消息 kind 时只改一头的解析 → 另一头静默丢消息；构造/解析必须同文件成对加。
- 恢复任何形式的「状态轮询 / 事件流 / 会话现场」——中继被动，扩展侧也没有（ADR-0011、ADR-0004 的补记）。
