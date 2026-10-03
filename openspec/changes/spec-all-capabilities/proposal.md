# Proposal: 全能力规格归档 (spec-all-capabilities)

## Why

`openspec/specs/` 目前只剩 `.gitkeep`；`src/lib/` 里已有 ~30 个模块（`fence/ask/reply/wait/page/action/messages/relay/channel/watchdog/gate/toggle/icon/backoff`…），只有 1 个（`outbound-backoff`）有规格归档在 `changes/backoff-after-mute/`。其他能力行为全靠代码与测试守，缺规格意味着：新改动没有需求基线、archive 无法完成、跨能力依赖无法显式声明（如 `outbound-backoff` 依赖 `page.readAccount`、`action.inQueue`）。先把已落的写进 `specs/`，再为核心缺规格的补档。

## What Changes

- 新建 `/specs/` 下系列能力规格（delta 或完整，按实际情况）：
  - `outbound-backoff`：同步已完成的退避规格（从 `changes/backoff-after-mute/` 迁移）
  - `gate`：总开关、权限钉死、站点范围固定
  - `watchdog`：漂移拉回、静默催办、连催停手
  - `fence` / `ask` / `reply`: 围栏、提问、回灌协议
  - `action` / `message`: 页面动作流、对话读取
  - `channel`: SSE 下行通道、动作流订阅
  - `toggle`: 图标状态切换、存储面
- 不改动实现代码；只写 `spec.md`，行为由源代码 / 测试已确定。
- `backoff-after-mute` change 最终归档时，这些规格成为它的需求基线。

## Capabilities

### New Capabilities
- `outbound-backoff`: 账号处境判定与退避（已实现，需同步到主目录）
- `gate`: 总开关与站点范围固定（`toggle.ts`, `page.ts` 相关）
- `watchdog`: 链子看门狗（`watchdog.ts`, `backoff.ts` 依赖）
- `fence`: 围栏协议识别（`fence.ts`）
- `ask`: 网页向人提问（`ask.ts`）
- `reply`: 回灌与首行锚（`reply.ts`）
- `action`: 页面动作执行（`action.ts`）
- `message`: 对话读取与消息流（`messages.ts`）
- `channel`: SSE 通道与阻塞式串行队列（`channel.ts`）
- `toggle`: 图标状态与持久存储（`toggle.ts`, `icon.ts`）

### Modified Capabilities
- 无（现有源码行为未变，仅补规格）

## Impact

- `openspec/specs/` 从空变为 10+ 文件，archive 变可行
- `backoff-after-mute` 归档时有基线可引用
- 后续新 change（如 #30/29/28/24）可直接引用能力而非重读源码
