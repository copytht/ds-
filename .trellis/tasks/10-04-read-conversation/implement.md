# 执行计划：角色判据换成渲染层（气泡）

## 顺序清单

- [ ] **1 研究：钉死「气泡」判据**
  - 真机量**含 `<pre>` / 表格的助手行**与用户气泡行，取 `getComputedStyle` 的
    `backgroundColor`/`borderRadius` 与 `getBoundingClientRect` 的左右缘。
  - 定阈值：圆角多大算气泡、右缘贴到什么程度、要不要「包住整行正文」这条。
  - 样例与数字落 `.trellis/tasks/10-04-read-conversation/research/role-bubble.md`。
- [ ] **2 `src/lib/messages.ts`**
  - 加 `StyleProbe`（探测口）+ `domProbe`（`getComputedStyle`/`getBoundingClientRect`）。
  - `roleOf(row, probe)`：三层解析（标记 → 渲染气泡 → `unknown`）。
  - `readRow` 改用它；正文仍走 `rowText`。
- [ ] **3 契约**
  - `MessageRole` 加 `"unknown"`；同步 `protocol/` 样例与 Python 侧契约与测试。
- [ ] **4 测试**
  - 替身 probe：用户气泡 / 助手素文 / 助手含 `<pre>` / 表格 / 无任何线索 → 角色正确或 `unknown`。
  - 保留既有 fixture（经典标记那套）不回归。
- [ ] **5 真机复验**
  - `scripts/env-up.sh --debug` → `scripts/page-action.py send messages.list` / `messages.last`
    看角色 + 正文；再挑一段带围栏/代码块的对话验正文还原。
- [ ] **6 spec**
  - `frontend/site-dom-anchors.md` 补「角色三层解析（标记 → 渲染气泡 → unknown）」与
    「jsdom 不布局 → 必须走探测口」两条。

## 验证命令

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm quality        # 全门
```

## 复查门

- 角色判据不再以 `ds-*` 类为唯一依据；两套渲染都能判。
- 渲染层判据**不会**把助手内容里的代码块/表格误判成气泡（研究第 1 步的数字说了算）。
- 认不出 → `unknown`，没有静默丢、没有猜。
- 契约（`MessageRole` / 协议样例 / Python 侧）一致；`pnpm quality` 全绿。
- 真机 `messages.*` 角色 + 正文正确。

## 回滚点

- 渲染层单独一刀：若真机量出来的判据不稳，`roleOf` 退回「标记层 + unknown」，零回归。
- 契约那刀（加 `unknown`）可独立回退到「判不出整条报 `page-changed`」。
