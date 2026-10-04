# 组合功能 send.page：发问题→等围栏→等回灌→取答复

来源：GitHub issue #23（父 issue #15，Blocked by #19/#22——都已入库）。
目标：一条调用完成「发问题 → 等围栏 → 等回灌 → 取答复」，调用方不用自己
串原语。

## Goal

1. **一条调用完成四步**：打问题进写作框 → 发送 → 等下一条围栏 →
   等回灌 → 返回答复正文。
2. **中途失败给在册失败码**：页面不在 / 超时 / 闸关着，都落到
   现有册子（`tab-gone` / `timeout` / `disabled` 等），不编新码。
3. **「代你发言」闸照拦**：发送步走 `runAction` 同一道闸
   （总开关 / 替人发言 / 退避），闸关着回 `disabled`，不静默照发
   （issue 明文要求）。

## Confirmed Facts（证据）

- **动作名册没有外部调用通道**：`runAction` 只被 background 调用
  （出站 `background.ts:406/409`、看门狗 `:574`）；native messaging
  零引用（`connectNative` 全仓库无匹配）；dsb 的 `/action` 路由随
  ADR-0011 全废。外部 agent（MCP 客户端）今天调不到任何页面动作。
- **组合作法有先例**：`deliverNudge`（`background.ts:400-411`）
  就是 composite——`composer.type` → `send.enter`，两步都走
  `runAction`，三道闸照拦，前半句没成就不发后半句。
- **等待原语现成**：`waitFence` / `waitReply`（`src/lib/wait.ts:115/137`，
  默认 25s、上限 25s，超时抛 `ACTION_ERROR_TIMEOUT`）。
- **围栏流**：网页模型排 ```send 围栏（工具调用 JSON）→ inject 认出
  → content → background → dsb `POST /mcp` `tools/call` → 结果回灌。
  网页模型的「工具表」= dsb 的 `tools/list`（mcp.json 配好的
  servers + 自家 `said_*`）。
- **dsb 被动**（ADR-0011）：不轮询、无会话、不推送；唯一端点
  `POST /mcp`。dsb↔扩展之间没有反向通道（扩展是 MCP 客户端，
  dsb 是服务端）。

## Key Decision（待拍板——开工前）

**Q1：组合住哪、给谁用？** issue 写「组合在 dsb 侧，任何 agent
开箱即用」——那是四刀前（dsh 宿主 + dsb /action 通道）的架构措辞。
今天 dsb 被动到底、无反向通道，「dsb 侧组合」在架构上不可行：
dsb 没法让扩展干活。候选：

- **A（推荐）：扩展侧 background 组合 + 围栏本地截获。** 扩展持一
  小张「本地工具名册」（先只 `send.page`）：网页模型在围栏里排
  `send.page` 时，扩展认出后**就地执行**（`composer.type` →
  `send.enter` → `waitFence` → `waitReply`，全走 `runAction`
  三道闸），不把该调用转发 dsb；结果按回灌口径回页面。协议说明
  （`instructions.ts`，现按工具目录现拼）加「本地工具」段。dsb
  仍被动，零改动。
- **B：dsb 侧组合（issue 字面）。** 要重新引入 dsb↔扩展 的双向
  通道（四刀刚废掉的），破 ADR-0011，得改 ADR 并大改两层。
- 选 A 的代价：外部 MCP agent 依然调不到页面动作——但现状本就
  如此（整个名册都无外部入口），不是回退；「外部 agent 入口」若
  要，是另一个任务（重开通道，大改）。

## Requirements（Q1 拍 A 后）

- R1：`send.page` 进本地工具名册；围栏检出时先查本地名册，命中
      就地执行，未命中才转发 dsb（现有转发路径不动）。
- R2：协议说明拼上本地工具段（名字、参数、一句说明），让网页
      模型知道可以排 `send.page`。
- R3：复合步骤复用 `deliverNudge` 的闸纪律与 `wait.ts` 的等待
      原语；失败码全在册（`disabled` / `tab-gone` / `timeout` /
      `page-changed` / `read-failed`）。
- R4：参数口径：`question`（必填）；可选 `seconds`（等待上限，
      归一到 `wait.ts` 的 1–25s）。

## Acceptance Criteria

- [ ] 网页模型在对话里排一次 `send.page` 围栏，扩展就地执行四步，
      回灌里拿到答复正文。
- [ ] 闸关着（总开关 / 替人发言 / 退避中）时回 `disabled`，页面
      上没有发送动作发生。
- [ ] 页面不在 / 超时（25s 没等到围栏或回灌）回在册失败码，不
      假成功。
- [ ] `pnpm quality` 全绿；协议说明的黄金值测试同步（`instructions.test.ts`
      从实产出回抄）。

## Out of Scope

- 外部 agent（MCP 客户端）调用页面动作的通道——另一个任务。
- 本地工具名册继续扩容（#30 的控件补全先走原语路线）。
- dsb 侧任何改动（组合在扩展侧，dsb 零改动）。

## Open Questions（blocking）

- Q1（见 Key Decision）：组合住哪、给谁用。A/B 二选一。
