# Tasks: 出站退避

> design.md 的 Open Question 2（退避时长要不要可配）按 design 里 stated 的倾向处理：**写死**（10 分钟 ×2 封顶 8 小时），不做成配置。以后要调再加 `options` 输入框。Open Question 1（退避触发点）第一版只从长休迁入，不接限流信号——禁言期间抓不到站点限流的真实形态。

## 1. 失败码

- [ ] 1.1 `protocol/fixtures/action.json` 的 `errorCodes` 加 `backing-off`（when：账号在处罚区 / 退避中，动作没推给页面）
- [ ] 1.2 `dsb/actions.py` 的 `ACTION_ERRORS` 加 `ERROR_BACKING_OFF = "backing-off"`
- [ ] 1.3 `tests/test_actions.py` 的一致性断言加上 `backing-off`（三处同步，门会红直到三处齐）

## 2. 退避层（background 侧，判定在 background 不在内容脚本）

- [ ] 2.1 新模块 `src/lib/backoff.ts`：三态（正常 / 长休 / 退避）与迁移函数，输入是 `readAccount()` 的输出 + 存储里的 `backoffUntil`
- [ ] 2.2 阶梯时长：第一回 10 分钟、每回 ×2、封顶 8 小时；`until = null` 的长休按退避态处理（design 的兜底）
- [ ] 2.3 持久化：退避终点写 `browser.storage.local` 的 `backoffUntil`，重启后仍记得

## 3. 入队前判定

- [ ] 3.1 `entrypoints/background.ts` 的动作处理里，写动作入队前先问退避层；退避中 / 长休中 → 当场回 `backing-off`，不进内容脚本
- [ ] 3.2 只读动作永不受影响（`tabs.list` / `page.state` / `composer.read` / `messages.*`）
- [ ] 3.3 总开关与「替人开口」两道闸的顺序不变——退避闸在它们之后（开关关着还是回 `disabled`）

## 4. 到点探活

- [ ] 4.1 长休到 `until`、或退避到期后，第一笔写动作先做只读判定（写作框在不在），在才放行，不在继续回 `backing-off`
- [ ] 4.2 探活成功即把持久存储里的 `backoffUntil` 清掉，回到正常态

## 5. 测试

- [ ] 5.1 `src/lib/backoff.test.ts`：三态迁移（认出处罚句进长休、到期探活回正常、阶梯 ×2 封顶、`until=null` 走退避、重启后仍记得）
- [ ] 5.2 `src/lib/action.test.ts` 或新用例：退避中写动作回 `backing-off`、只读动作照常
- [ ] 5.3 `channel.test.ts`：`backing-off` 在册（沿用既有「码必须在册」用例的判据）

## 6. 真机验收（禁言期间就能验）

- [ ] 6.1 禁言页面上打 `composer.type` → 回 `backing-off`（不是 `composer-absent`——退避层拦在它前面）
- [ ] 6.2 同一页面上打 `messages.last` / `page.state` → 照常回结果
- [ ] 6.3 `page.state` 的 `account` 仍是 `muted`（带解封时刻）
- [ ] 6.4 解封后（10-10 20:21 之后）第一笔写动作先探活：写作框在才放行
