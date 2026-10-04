# 修 wait.* 的新行判据：站点行 key 带符号（#37）

来源：GitHub #37（真机验 #23 send.page 时发现）。`wait.reply` 对当前站点**必 timeout**：
行 key 带符号（生成中挂负 key 的待定行），`wait.ts` 的 `key > baseline` 对负 key 的回灌
永不成立。

## Goal

1. `wait.fence` / `wait.reply` 能在当前站点认出「基线之后的新消息」，**含生成中出现的
   负 key 行**。
2. `wait.*` 撞上「消息列表还没挂载」时**等挂载**，而不是当场 `page-changed`。
3. 不误认旧消息：视口里重新挂出的旧行（`|key| ≤ 基线`）不算新。

## Acceptance Criteria

- [ ] 单测覆盖：负 key 的新回灌被认出；`|key| ≤ 基线` 的旧行被忽略；列表**晚挂载**能等到。
- [ ] 真机（随机延迟、少发）：send.page 四步收口拿到 `status: ok` + 答复正文（#37 症状消失）。
- [ ] `pnpm quality` 全绿。
- [ ] 失败码口径不变（`timeout` / `page-changed`）。

## Out of Scope

- 站点 key 方案的逆向工程：只按真机样本定「`|key|` 单调」这一条**可测假设**；站点再变
  由真机复验 + 单测先红。
- `messages.*` 的其它判断（`keysOf` 只当「挂载行变了没」的探测器，不受符号影响）。
- send.page 自身（#23 真机已验 OK：截获 / 就地执行 / 闸 / 四步调用都对）。

## 待定（实现时定）

- 列表**永不**挂载时回 `page-changed`（页面确实没有列表）还是 `timeout`（等不到）。
