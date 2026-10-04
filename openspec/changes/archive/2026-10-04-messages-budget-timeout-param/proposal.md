# Proposal

## Why

`messages.list` 的两段预算**串联**：`readyWithin`（等就绪，5s）+ `readMessages` 扫描
（25s）= 最坏 30s，正顶着中继的 30s 锁。那个 25s 的注释写着「留 5s 余量让真失败报得出来」，
但**前提已经被我上一轮改掉了**（当初读动作只花 25s）。撞上锁就是真原因被吞成中继的
`timeout`——正是 `readMessages` 注释反复强调要避免的事。

根子在于：`messages.*` 是**唯一没有 `timeout` 入参的动作**（`wait.*` 有），预算只能写死，
既没法让调用方按对话长度调节，也没法把两段预算的关系写进契约。

## What Changes

- `messages.list` / `messages.last` SHALL 支持 `params.timeout`（秒），口径与 `wait.*`
  完全一致：缺省 25、钳 `[1, 25]`、非法值按缺省（复用 `wait.ts` 的
  `parseWaitSeconds`，不另立一套）。
- **一个 `timeout` 管两段**：就绪等待与扫描**共用**这份预算——就绪花掉的时间从扫描里扣，
  不是各自独立计时。这样「最坏 = 预算」恒成立，与中继的 30s 锁留足余量。
- 契约同步：`protocol/fixtures/action.json` 补 `timeout` 入参样例（`wait.fence` 已有先例）。
- `messages.last` 只读最后一屏、不扫全量，**同一个入参也给它**——口径统一，别留特例。

## Capabilities

### New Capabilities

（无。）

### Modified Capabilities

- `site-dom`：给 `messages.*` 的「预算内等就绪」那条 requirement 补上「预算由
  `params.timeout` 定、就绪与扫描共用」——现在那条只说「预算内」，没说预算从哪来、
  怎么分。

## Impact

- 代码：`src/lib/messages.ts`（`listMessages` / `lastMessage` 接 `parseWaitSeconds`，
  `readyWithin` 与 `readMessages` 改为共享 deadline）、`src/lib/wait.ts`
  （`parseWaitSeconds` 导出给 `messages.ts` 用，语义仍归 `wait` 域）。
- 契约：`protocol/fixtures/action.json` 补样例；**失败码一个不动**（不新增）。
- 测试：`messages.test.ts` 补「timeout 管两段、就绪花掉的时间从扫描扣」「钳位与非法值」
  两条；`wait.test.ts` 的 `parseWaitSeconds` 既有断言不回归。
- 不受影响：`wait.*` 的行为、`page.state` 等其余动作、Python 侧。
