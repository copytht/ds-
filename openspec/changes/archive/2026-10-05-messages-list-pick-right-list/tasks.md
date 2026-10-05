## 1. 挑列表那层

- [x] 1.1 `src/lib/page.ts` 把 `COMPOSER_SELECTOR` `export` 出来（`messages.ts` 要复用同一个写作框锚）
- [x] 1.2 `src/lib/messages.ts` 新增 `conversationList(root)`：按序取首个命中——列表里装着写作框 → 列表带 `ds-virtual-list--printable` → 列表里有含 `.ds-message` 的行；三条都不中回 `null`
- [x] 1.3 `conversation()` 改成先 `conversationList()`，只在**对话列表**里找行、再走原来「从行往上找真滚得动的层」；`conversationList()` 回 `null` 且页面上有行 → 抛 `page-changed`，**不再拿第一个命中行倒推**（签名与「一行都没有 → null」的契约不变，`wait.ts` 不动）

## 2. 收行身份

- [x] 2.1 `sweepInto` 身份改成 `key ?? rowText(row)`：有 key 照旧按 key 去重，没 key 用正文；正文也空 → 不收（`readRow` 在身份定下来之后再调）
- [x] 2.2 更新 `sweepInto` / `ROW_SELECTOR` 两处注释：点名 #37 只改了 `wait.*`、这次把口径收成一条，并写明「同正文两条只留一条」的已知取舍

## 3. 就绪与早退口径

- [x] 3.1 `readyWithin` 改用 `conversationList()` 轮询：认得出列表但 0 行 → 等下一轮；认不出（页面上有行）→ 当场 `page-changed`，不进轮询
- [x] 3.2 `listMessages` / `lastMessage` 的早退条件从 `conversation(document) === null` 改成「任何 `.ds-virtual-list` 里都没有行 → 回空数组」；页面上有行而对话列表 0 行 → 进轮询，不回空数组
- [x] 3.3 `listMessages` / `lastMessage` / `readyWithin` 的文档注释同步（新对话按「哪儿都没行」判、行没挂时会轮询）

## 4. 单测（fixture 照抄真机结构）

- [x] 4.1 两条列表的 fixture：主列表（`ds-virtual-list--printable` + 里面 `textarea` + 0 行）+ 右缘面板（行无 key、无 `.ds-message`、3 行）——断言 `conversation()` 认主列表、不把面板的行读出来
- [x] 4.2 无 key 行的 fixture：`visible-items` 直接子元素、哈希 class、无 key —— 断言照样进 `messages.list` 结果；老版带 key 的既有 fixture 一条不改、断言行为不变
- [x] 4.3 早退口径两例：哪儿都没行 → 秒回空数组（不轮询）；对话列表 0 行而别处有行 → 注入假时钟 + 即时 settle 走完预算后报 `page-changed`，预算内挂上行则读出来
- [x] 4.4 「三条判据都不中且页面上有行」→ 当场 `page-changed`，断言不进轮询（用假时钟断言一步没走）

## 5. 门禁

- [x] 5.1 `pnpm quality` 全绿（vitest + pytest + prettier + ruff）
- [x] 5.2 `openspec validate --all --archived --strict` 与 `openspec validate --specs --strict` 全绿

## 6. 真机复验（最后一道）

- [x] 6.1 `scripts/env-up.sh` 跑一遍：重建产物、换中继、ds-browser 装上最新扩展，会话标签页开在票里那个会话
- [x] 6.2 前台可见的标签页上 `send messages.list`：#54 那个会话（两条列表并存）读出主列表 2 条真消息、`messages.last` 读到末条；不再 `page-changed`（修前同页稳定 `page-changed`，已量到）。附带查清「隐藏标签页站点不渲染对话」这个前置条件
- [x] 6.3 新对话上 `messages.list`：秒回空数组（动作耗时 0.08s / 0.23s），不吃 25s 轮询、不报错
- [x] 6.4 结论回贴 #54：修前/修后实测对照、票里建议 C 那处口径纠正、「隐藏标签页站点不渲染对话」这条前置、以及残余边界（导航刚落地那一瞬可能回空数组）
- [x] 6.5 `/opsx-archive messages-list-pick-right-list`：`site-dom` +2 条 ADDED、1 条 MODIFIED 并进主 spec（逐条核对场景一一对应，MODIFIED 的原有场景名一字不改）
- [x] 6.6 开分支 `messages-list-pick-right-list`、提 **PR #59**，描述挂 `Fixes #54`。
      （**CI 全绿不算任务**：CI 卡的就是「任务全勾」这一条，写成任务是自己造的死循环——
      门的判据是这个 PR 的 CI 过了才合并。合并 `gh pr merge --merge` 与删分支是 PR 收尾。）
