# 优化测试环境：本机探得到扩展那一半

## Goal

`scripts/env-up.sh` 的三条判据只能验**本机这半**；**扩展那一半**
（SW 活着、总开关、账号处境）只能靠人看图标与悬停。把「扩展活着
与否」变成脚本可读的判据，环境验收不再依赖人肉。

## Confirmed Facts（证据）

- 扩展每 30s 周期探活一次（alarms 下限），**只在总开关开着时排班**
  （`entrypoints/background.ts:325`、`wxt.config.ts:20`）；探活走
  JSON-RPC `ping`（`src/lib/relay.ts`）。
- dsb 对 `ping` 只回 `{}`、**成功不记日志**（`dsb/mcp.py:160`）；
  日志口径是「失败与慢」（`dsb/log.py:1`），访问日志整个关掉
  （`dsb/server.py` 的 `log_message` 被禁）。
- dsb 对未知 notification 静默回 202（`dsb/mcp.py:167`）；
  `log_event` 只收具名字段，正文进不来靠签名（`dsb/log.py:47`）。
- 账号处境（ready / muted / signed-out / unknown）扩展侧已知
  （`src/lib/action.ts:193` `probeAccount`），悬停标题会露出。
- 中继日志路径不固定：env-up 起的中继写 `/tmp/dsb-relay.log`；
  `dsb/log.py` 文档约定的自起写法是 `/tmp/dsb.log`。

## Key Decisions

- **Q1 已决（2026-10-04，用户拍板）：A+C。**
  - A：dsb 记 ping 成功——`dsb/mcp.py` 的 `ping` 分支加
    `log_event("ping")`。零协议改动、零扩展改动、dsb 仍无状态
    （日志不是状态）；与「访问日志关着」的张力用户已接受：
    只此一端点、事件名固定、无正文。
  - C：env-up 加 `--status` 只读模式（构建 / 中继 / 浏览器 /
    最后扩展探活的汇总，不改动任何东西）。
  - 不做 B（`extension/heartbeat` notification）：增量价值
    （shell 里读账号处境）暂无场景，悬停标题已覆盖给人看的部分。
- **自检换方法（设计要点，见 design.md）**：脚本自己的健康探活从
  `ping` 换 `initialize`——否则脚本自检的 ping 也进日志，
  「最后探活距今」永远刚发生，判据失效。dsb 不记 `initialize`，
  ping 日志就成了纯扩展信号。

## Requirements

- R1：env-up 判据含「扩展最后探活距今多久」，>90s 报红；
      读不到日志与「日志里没 ping」要区分（前者是路径问题，
      后者是扩展没探活）。
- R2：不破坏既定决策：dsb 无状态（ADR-0011）、日志不记正文
      （ADR-0004）、访问日志关着（除新增的 ping 一行外）。
- R3：判据描述同步——`AGENTS.md` 的「中继 ping 健康」改述为
      自检走 `initialize`、ping 日志读扩展。

## Acceptance Criteria

- [ ] `dsb/mcp.py` 的 ping 成功留痕：`[ts] ping` 一行；
      pytest 加一例（caplog 抓到）。
- [ ] `scripts/env-up.sh`：判据 1 自检走 `initialize`；新判据
      「扩展最后探活」读日志（候选 `/tmp/dsb-relay.log`、
      `/tmp/dsb.log`），>90s 报红；`--status` 只读汇总可用。
- [ ] 开关关着时判据报「未探活（总开关关着也会这样）」而非假红。
- [ ] `pnpm quality` 全绿；`AGENTS.md` 判据描述已同步。

## Out of Scope

- B 全量心跳（协议面 +1 method，跨两层，补 ADR-0011）。
- 构建时 bump 版本号根治 SW 缓存（mtime + 自动重启已覆盖；
  副作用：版本号漂移、扩展管理页条目堆积）。
- 账号处境进 shell 判据（悬停标题已覆盖）。

## Risks / Deferred

- 用户自起中继且日志输出在别处 → 判据读不到日志 → 报「未知」
  而非假绿（实现时区分两种「没有」）。
- ping 日志量：开关开着时约 2 行/分钟，可忽略。
