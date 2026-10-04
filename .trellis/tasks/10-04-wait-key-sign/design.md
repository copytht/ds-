# 设计：wait.* 新行判据改认 |key|

## 诊断（真机，见 `research/row-keys.md`）

- 站点在**生成中**挂出负 key 的待定行（-4/4、-6/6、-8/8）；静置后收敛成全正单调。
- `baselineKey` 取挂载行**最大** key；`waitUntilNewMessage` 用 `key > baseline`。
  生成中的回灌是**负 key** → 永远 `> 正基线` 不成立 → `wait.reply` 必 timeout。
- `wait.fence` 找助手侧正 key，恰好还能过——与真机观测一致（围栏成了、回灌 timeout）。

## 决定

1. **基线改记 key 的绝对值高水位**：`baseline = max(|key|)`，一行都没有回 `-1`。
2. **新行判据改 `Math.abs(key) > baseline`**：负 key 待定行与静置后的正 key 行都算新；
   `|key| ≤ 基线` 的旧行（滚动重挂）不算。
3. **`wait.*` 等挂载**：`conversation()` 为空时不当场抛；在预算内轮询等列表出现，
   耗尽仍没有 → `page-changed`。
4. `messages.ts` 的 `keysOf` 只做「挂载行变了没」的字符串比较，**不动**。

## 契约

- `baselineKey(view, settle)` → `max(|key|)`（认不出的 key 不算；无行 → `-1`）。
- `waitUntilNewMessage(view, baseline, deadline, matches, interval)` → 只看 `|key| > baseline` 的行。
- `waitFence` / `waitReply` → 先算 deadline → 等挂载 → 基线 → 轮询；
  等不到 → `timeout`；列表始终不在 → `page-changed`。失败码不变。

## 权衡

- **为何用 |key| 高水位、而非「key 集合」**：集合法会把「基线时没挂载、之后滚动重挂的旧行」
  误当新行；高水位对旧行天然免疫（旧行 `|key| ≤ 水位`）。
- **为何不追站点内部语义**：样本够定「`|key|` 单调」这条可测假设；站点再变，真机复验先红。

## 测试

- `baselineKey`：负/正混排取 `max|key|`；非数字 key 不算；空列表回 `-1`。
- `waitUntilNewMessage`：负 key 的新行被认出；`|key| ≤ 基线` 的旧行被忽略；`matches` 跳过继续认。
- `waitFence/waitReply`：列表**晚挂载**（异步插入）能等到；始终无列表 → 预算后 `page-changed`；
  基线里的旧围栏 / 旧回灌不误认 → `timeout`。

## 风险

- `|key|` 单调是**样本归纳**、不是站点契约；站点若换方案，单测 + 真机复验会先红。
- 「等挂载」把「新对话当场报错」变成「等满预算才报错」——探针手感变慢，但语义更对。
