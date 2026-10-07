## Context

- `setToggleOption`（`src/lib/page.ts`）：校验 `enabled` → 找开关 → `readToggleState(el) !== enabled` 才 `el.click()` → **同步** `return { enabled: readToggleState(el) }`。
- 2026-10-07 真机：点完立即读是旧值；`toggles-off` 脚本因此自己加了 5 秒轮询绕开。
- `ActionRoster` 的值类型是 `(frame) => unknown`，`messages.list` / `wait.*` 已是 async，收信那层（`channel.ts`）按 Promise 处理。
- 约束：动作 30s 中继锁；`src/**` 不碰 console；不 hook 站点。

## Goals / Non-Goals

**Goals:**

- 点完等稳定再回真实达成态。
- 站点真拒时仍如实回未变的值。
- 超时有明确上限，不挂着。

**Non-Goals:**

- 不改其它写动作的「回 `{}` 不回读」约定。
- 不改失败码；站点拒绝仍是成功返回、`enabled` 为未变的值。

## Decisions

### 1. 轮询 `aria-pressed`，上限 1500ms、间隔 50ms

点开关到 `aria-pressed` 更新是前端状态机的一拍，真机观察是几百毫秒内。1500ms 给足余量又不拖：站点真拒时最多多等 1.5s 才回，
远小于 30s 中继锁。**否决**固定 `sleep`：快的白等、慢的仍读旧。**否决**监听 `MutationObserver`：多一层机制，轮询 30 次就够，
且 jsdom 里更好测。上限与间隔放常量（`TOGGLE_SETTLE_MS` / `TOGGLE_POLL_MS`），测试用 fake timers 推进，不真等。

### 2. 到目标态就立刻收，不等满

轮询每拍读一次，`=== enabled` 就返回——正常情况几十毫秒就回，不因加了上限而变慢。

### 3. 上限到了按当时读到的收，不抛

站点拒绝在原契约里就是成功返回 + 未变的值（spec「站点拒了这一拨」），沿用。**否决**超时抛 `timeout` 失败码：
调用方分不清「站点拒」和「我们等不到」，而对开关来说两者的下一步相同（再 `get` 一次看真值）。

### 4. 幂等路径不变

已在目标态不点、不轮询，立即回——避免给幂等调用平白加延迟。

### 5. `toggles-off` 去掉自己的轮询

这个脚本是 #81 的受害者，自己加了 5 秒 `.get` 轮询绕过。执行器修好后它应当信任 `set` 的返回；保留会掩盖回归（执行器又坏了脚本仍绿）。
改成：`set` 返回 `enabled === false` 才算关上，否则报「没关上」。

## Risks / Trade-offs

- [执行器变 async，调用方若同步用返回值会拿到 Promise] → 唯一调用方是名册（`ACTION_ROSTER` 值类型允许 Promise），测试一并改 `await`。
- [站点真拒时多等 1.5s] → 可接受；远小于中继锁，且是少见路径。
- [1500ms 对极慢的前端不够] → 超时仍如实回当时值，调用方再 `get` 即可；不会说谎，只是回得保守。
- [轮询期间页面被卸载 / 开关消失] → 每拍都用已持有的元素读 `aria-pressed`；元素脱离 DOM 时读到的是最后的值，按「达成态」收，不额外判错。

## Open Questions

- 1500ms 是否合适，等有更多真机样本再调；本 change 先按观察到的「几百毫秒」取。
- 本 change 不引入新的长期架构决策。
