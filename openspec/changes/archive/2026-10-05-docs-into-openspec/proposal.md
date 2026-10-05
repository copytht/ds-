# Proposal

## Why

`docs/` 里有三类东西，只有一部分真该进 `openspec/specs/`：

| 内容              | 性质                                                     | 该去哪                        |
| ----------------- | -------------------------------------------------------- | ----------------------------- |
| 9 篇 ADR          | **决策历史**——为什么这么定、被否决的方案、后来推翻的结论 | **ADR 目录**（不是 specs）    |
| `page-actions.md` | 规格：页面动作候补控件的登记口径                         | `openspec/specs/local-tools/` |
| `agents/` 3 篇    | 工作方式：`gh` 用法、标签约定、文档地图                  | `AGENTS.md`                   |

## 调研结论（2026-10-05 搜 GitHub 确认，不是我拍的）

**OpenSpec 默认 schema 有一个已知缺口**：archive 时只有 spec delta 被往前同步，
`design.md` 里的**理由随 change 一起消失**。Fission-AI/OpenSpec issue **#557** 就是请求加
ADR 支持的——说明官方在考虑，默认 schema 至今没有。

社区已有现成方案：**`spec-driven-with-adr` 自定义 schema**（OpenSpec 技术顾问
Hari Krishnan 构建，文档在 intent-driven.dev）。它的关键设计是——

> ADR 放在**仓库根 `/adr/`（如 `/adr/0042-use-postgres-for-catalog.md`），与 `openspec/`
> 平级，不嵌套在里面**。理由：放进 `openspec/changes/` 会被 archive 掉，达不到目的——
> ADR 必须**跨 change 存活**。

而两者的分工：**specs 讲系统今天做什么；ADR 讲它今天为什么是这个架构。**

所以「把 docs 全部迁进 `openspec/specs/`」会**犯社区已识别出的那个错**——把「为什么」塞进
「是什么」。本 change 走社区惯例。

## What Changes

- **换 OpenSpec workflow schema 为 `spec-driven-with-adr`**（第三方社区 schema，
  intent-driven-dev/openspec-schemas，OpenSpec 技术顾问 Hari Krishnan 构建）：vendor 进
  `openspec/schemas/spec-driven-with-adr/`，`openspec/config.yaml` 启用。artifact 从 4 个变
  5 个——`proposal → specs → design → **adr** → tasks`，`tasks` 要 `adr` 齐了才开始。
  它补上默认 schema 的已知缺口：archive 时 `design.md` 的理由会随 change 沉档，未来的
  proposal 看不见。持久 ADR 落在**仓库根 `adr/`**（见下）。
- **`docs/adr/` → `adr/`**（仓库根，与 `openspec/` 平级）：历史保住、跨 change 可见。
  9 篇各补 `Status` / `Date` / `Supersedes` 三行头（正文一字不改），让 design 步读得出
  supersession 图；新开第 10 篇 `adr/0017-adrs-live-beside-openspec.md` 记本次的长期承诺。
- **`docs/page-actions.md` 拆进两处 spec**：候补控件的登记纪律 → `frontend`（它就在
  「页面动作四处对齐」的「控件还没实现」场景里被点名）；两个开关的锚点契约 → `site-dom`
  （`div.ds-toggle-button` 按中文文字认、`aria-pressed` 只认 `true`、set 幂等回达成态）。
- **`docs/agents/` 3 篇 → 并进 `AGENTS.md`**：它们本来就是 `AGENTS.md`「Agent skills」
  节指路的三篇，内容并进去后文件删掉。**其中两段死内容不搬**（指向本仓不存在的
  `/wayfinder`、`/domain-modeling` 等技能），记在 `adr.md` 的 Notes 里。
- **补三篇 spec 缺口**（这才是「知识进 openspec」的真正价值）：ADR-0012 / 0015 / 0016 的内容
  **零 requirement 覆盖**，而它们都有测试钉着的常量兜着：
  - **0012** dsb 五件工作工具：root 钉死、不给 SHELL、拒写 `.git/`、每件的工具载荷码、上限
  - **0015** 一次回答多块围栏：检测全取、执行一趟一块、`MAX_CALLS_PER_ROUND = 8`、坏块不拖垮整轮
  - **0016** 网关封顶：结果 64K 字、单服务 128 件、三档超时

**结果**：`docs/` 消失 · `openspec/specs/` 保持纯规格 · ADR 历史保住且位置符合社区惯例 ·
三个真缺口补上。

## 非目标

- **不换 `spec-driven-with-adr` schema**：那要让 ADR 成为流程的一部分，代价是装第三方 schema、
  `.opencode/` 的命令与技能会变（AGENTS.md 说那些是生成物、别手改）。先手动放到 `/adr/`，
  等真要加 ADR 能力时再换。
- **ADR 内容不改写**：它们是历史记录（含「三态状态机已作废」这类），不是待同步的规格。

## Capabilities

### New Requirements（`backend`，三条）

- dsb 五件工作工具的边界（root 钉死 / 不给 SHELL / 拒写 `.git/` / 载荷码 / 上限）
- 一次回答可排多块围栏（一趟一块 / 轮内上限 / 坏块不拖垮）
- 网关对交出去的东西封顶（结果 64K 字 / 单服务 128 件 / 三档超时）

### New Requirements（`frontend`，一条）

- 页面动作候补控件的登记口径（登记 ≠ 名册 / 三列候补表 / 用途未认出就不硬编 / 上真机先确认）

### New Requirements（`site-dom`，一条）

- 两个小开关按文字认控件（中文文字 / `aria-pressed` 只认 `true` / set 幂等回达成态）

### Modified Requirements

- `frontend` · **页面动作四处对齐**：场景「控件还没实现」不再指向 `docs/page-actions.md`
  （那个文件没了），改指本能力新增的候补表 requirement。
- `conventions` · **改协议要按清单同步动**：同步清单里的 `docs/adr/` 改成 `adr/`。
  两处都是整块替换，场景名一字不差。

## Impact

- **OpenSpec 配置与 vendor**：`openspec/config.yaml`（`schema:` 换）、新增
  `openspec/schemas/spec-driven-with-adr/`（8 个第三方文件）、新增 `.agents/skills/`
  （`architectural-decision-records`、`openspec-git-discipline` 两个配套 skill +
  `preferences.md` 记风格偏好）。
- 文件：移动 9 篇 ADR 到 `adr/`、新开 `adr/0017-…`；删 `docs/`（`agents/` 3 篇 +
  `page-actions.md`）；改 `README.md`（2 处引用 + 目录树）、`AGENTS.md`（并入 agents 三篇，
  「Domain docs」指到 `adr/`）。
- spec：`backend` +3、`frontend` +1 与 1 条 MODIFIED、`site-dom` +1、`conventions` 1 条 MODIFIED。
- 代码：**不动**（三篇 ADR 的行为都已有实现与测试钉着）。
- 流程：此后每个 change 多一个 `adr.md` 必答题；`tasks` 要等 `adr` 完成才开始。
