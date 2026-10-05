# Spec Delta

## MODIFIED Requirements

### Requirement: 写新逻辑前先找

落笔前 SHALL 先按既有主题找一遍近亲：解析跨边界载荷 → `channel.ts` 的 `parse*`；
构造消息 → 同文件的 `*Message()`；定时器 → `wait.ts` / `watchdog.ts`；退避 → `backoff.ts`；
唯一 id → `id.ts`；storage 键 → 各模块常量；与 MCP server 说话 → `relay.ts` / `gateway.py`；
拼协议说明 → `instructions.ts`；失败码 → 三本册子。

**发消息到页面** MUST 按「哪一条路」分别找近亲，MUST NOT 当成一件东西：自动续聊 →
唯一出站口 `gate.ts`（ADR-0002，窗口 3–5 秒）；手动页面动作与看门狗催办 → `runAction` →
`page.ts`（受「代你发言」闸与退避闸，**不经** `gate.ts`）。归属见 `continuation` 能力的
「出站窗口是自动续聊这一路的收口」。

#### Scenario: 想写一个新 parse / 一个新信封

- **WHEN** 要解析或构造跨边界载荷
- **THEN** 先用现成主题里的 `parse*` / `*Message()`，没有才新建

#### Scenario: 要发消息到页面

- **WHEN** 要新写一条「把消息送进页面」的路
- **THEN** 先问它是续聊（排进 `gate.ts` 队列、受 3–5 秒窗口）还是手动/催办（走 `runAction`
  的动作与闸）；MUST NOT 因为「都是发消息」就当成同一条路——2026-10-05 实测就是这么长出
  第二条绕过出站口的路径的（#48）
