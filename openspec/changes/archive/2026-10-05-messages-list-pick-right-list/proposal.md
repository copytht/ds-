# Proposal: messages.list 挑对对话列表、收下没有 key 的行

## Why

#54：真机上 `messages.list` 在某个会话**稳定**回 `page-changed`，而同一页用 `js` 能读到文本。
今天（2026-10-05）复现到手：`send messages.list --params '{"timeout": 5}'` →
`{"ok":false,"error":"page-changed"}`。根因是**两层**，票里只写了第一层。

## What Changes

- **`conversation()` 不再「取第一个命中行、再拿它最近的 `.ds-virtual-list`」**——页面上出现
  第二个虚拟列表时会挑错它。今天真机抓到的第二个列表是右缘一个 `position: fixed` 的 34px 窄条
  （悬停展开成 240×210 面板），里面 3 行、`key` 全空、没有一行含 `.ds-message`；
  `conversation()` 挑到的正是它（`firstMatchGoesToList: 1`）。
- **`sweepInto` 不再把「行没有 `data-virtual-list-item-key`」当不合格行丢掉**——`#37`
  （f1c6638，2026-10-04）已经给 `wait.*` 认了无 key 行（`ROW_SELECTOR` 的结构位那一条 + 「无 key
  行正文集合」），`messages.*` 的收集路径**没跟上**：那批行一行都收不进来。票里的建议 C 把现状
  描述反了（原话「sweepInto 不因 key 缺而弃行」，代码是 `if (key === null || seen.has(key)) continue;`）。
  **真机复验后的修正**：前台可见时量到**当前版本主列表的行是带 key 的**（5 行 5 key），
  所以这条现在不是正在发生的病，而是「站点再换一次版就复发」的那道缝——补上它不改变今天的
  真机行为，票说的「新版站点上一行都收不进」要按未验证项看待。
- 不改动作码、不改线协议、不改 fixture：挑错与收不到最终仍以 `page-changed` 出去，只是
  「页面变了」的判定从**误报**回到**真报**。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `site-dom`: 新增两条 requirement——① 页面上不止一个 `.ds-virtual-list` 时怎么挑**对话**那一个
  （不许拿第一个命中行倒推）；② 行没有 key 时的身份口径（不许整片丢掉，身份靠什么记）。
  「`messages.*` 在预算内等就绪」那条不动：它管的是**多久读不出才算坏**，与这次的「挑哪个列表、
  收不收得下」正交。

## Impact

- **代码**：`src/lib/messages.ts`（`conversation` / `sweepInto`）、`src/lib/messages.test.ts`。
  `wait.ts` 不动（`#37` 已经按无 key 收）。
- **真机验证的前置条件**（已查清）：读对话这条路**要求标签页前台可见**——隐藏时站点
  **根本不渲染对话 DOM**（实测：新发一条消息，`visible-items` 0 子节点、`innerText` 不含
  正文、`items` 的 `min-height` 却已按内容算成 280px；点到前台再量就有行了）。
  先前那些「主区 0 行」「全站 0 个 key / `.ds-message`」全是这个假象。
  真机复验因此必须在窗口前台做（`env-up.sh --debug` + 把窗口点前台）。
- **不改**：失败码册子、`protocol/fixtures/action.json`、ADR（这次没有新的持久决定，
  `adr.md` 按 schema 记「无」）。
