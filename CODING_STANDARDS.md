# 编码标准

`AGENTS.md` 是**房规与导航**（常驻上下文，写它是为了让 agent 少走弯路）；本文件是
**判断题**——那种任何护栏都替代不了的跨文件一致性，由 review agent 施加（`/code-review`
的 Standards 轴）。机械性的那类不进这里，它们进 `pnpm quality` 与 `.husky/pre-commit`。

两条都是这次 build 走查之后补的（retro），来源记在每条末尾。

---

## 1. 判定放纯模块，接线层只做形状

**规则**：**决定行为的判定**（分支、迁移、口径计算）放在 `src/lib/` 的纯函数里——
不碰 DOM、不碰时钟、不碰 `browser.*`，`clock` 与 `random` 全部由参数注入。
`entrypoints/` 只做接线：取事件、喂参数、把结果写回去。

判据一句话：**如果这段判定错了，单测要能钉住它。** 判据藏在闭包里，就钉不住。

### 为什么

#52 把「闸关着时续聊该走哪条路」写进了 `entrypoints/inject.content.ts` 的 `flush()`
闭包。`pnpm quality` 全绿（645 个测试）的情况下提交，code-review 的 Spec 轴对着
「不按 Enter、不点发送键」那条 AC 读代码才发现：**挂完 `pending` 态仍往下走
`sendToPage()`**，闸形同虚设。同一批票里 #49 / #51 / #61 都按这条约定抽了纯模块，
所以它们是安全的——差别只在有没有抽。

### 怎么落地

- 新增一个判定 → 先问「它能被单测钉住吗」。答案是「闭包里钉不住」就先抽。
- 抽出来之后**接线层要真的分叉**，别抽完又让两条路汇到同一句。#52 的 `stage-only`
  那一支现在结构里就没有发送步骤，回归用例钉的是「那一支没有发送动作」。

### 不适用

纯 DOM 操作（`src/lib/page.ts` 那一堆 `findButton` / `pressEnter`）本就该在能看见
DOM 的地方，`vitest` 用 jsdom 覆盖。规则针对的是**判定**，不是所有代码。

---

## 2. 「修订型 ADR」写 `Supersedes: none` + 正文点名

**规则**：不推翻已接受 ADR、只**修订其中一点**时，新篇写 `Supersedes: none`，然后在
正文开头用一句话点名被修订的那一篇与那一点（写「只修订 X 的一点，其余不动」）。

**推翻**才写 `Supersedes: <旧篇号>`。

### 为什么

`docs/agents/domain.md` 说推翻已接受 ADR 必须由新篇点名，于是 Standards 轴会把
「Supersedes: none + 正文说修订」判成硬违规。但本仓既有做法恰恰相反：ADR-0012 写
`Supersedes: none` 去修订 ADR-0011 的那一点，ADR-0020/0021/0022/0023/0024 沿用。
两类写法的区别是**真的在讲一件事**，不是笔误。

不写下来，就每次开「修订型 ADR」都被报一次——reviewer 反复报同一条假阳性，噪音会
把真违规一起淹掉。

### 先例

`docs/adr/0012-dsb-ships-its-own-work-tools.md`（修订 ADR-0011）、
`docs/adr/0020`～`0024`。
