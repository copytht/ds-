# Design

## Context

`docs/` 里三类内容，只一类真该进 specs（ADR=决策历史、page-actions=规格、agents=工作方式）。
用户要求 `docs/` 彻底消失，但「全迁进 `openspec/specs/`」会犯一个**社区已识别出的错**。
调研后发现社区已有现成解法，于是这一步从「搬文件」变成「换 schema + 归位」。

## 调研结论（2026-10-05 搜 GitHub，不是我拍的）

**OpenSpec 默认 schema 的已知缺口**：archive 时只有 spec delta 被往前同步，`design.md` 的
**理由随 change 一起消失**。Fission-AI/OpenSpec issue **#557** 请求加 ADR 支持——官方在考虑，
默认 schema 至今没有。

**社区方案：`spec-driven-with-adr` 自定义 schema**（OpenSpec 技术顾问 Hari Krishnan 构建，
源在 intent-driven-dev/openspec-schemas）。关键设计：

> ADR 放在**仓库根 `adr/`，与 `openspec/` 平级，不嵌套**。放进 `openspec/changes/` 会被
> archive 掉，达不到目的——ADR 必须**跨 change 存活**。

分工一句话：**specs 讲系统今天做什么；ADR 讲它今天为什么是这个架构**。

## Decisions

1. **ADR 移仓库根 `adr/`，不进 `openspec/`。** 照社区做法。理由不是「openspec 校验不到它
   所以别放」，而是 **ADR 与 spec 是不同类别**：spec 是「必须怎样」，ADR 是「为什么这样定 +
   被否决的方案 + 后来推翻的结论」。把历史塞进 spec 会让 spec 变成决策日记，而且丢掉「这个
   决定后来被推翻了」这个维度——那正是将来有人问「为什么不做 X」时的答案（ADR-0002 的三态
   状态机作废、ADR-0012 修订 0011 一句就是这类）。

2. **换 schema `spec-driven-with-adr`**（完整理由与代价记在 `adr/0017-adrs-live-beside-openspec.md`，
   这里只留敢换的三条依据）：① 每个 change 的 `.openspec.yaml` 记着自己的 schema，在飞的
   `docs-into-openspec` 钉在旧的 4-artifact 上，迁移标记后 4/5 正常，**旧 change 不受新配置
   影响**；② `.opencode/` 的 `/opsx-*` 命令**不用重新生成**——artifact 顺序是从
   `openspec status --json` 读的（`opsx-propose` 第 5 步「Get the artifact build order」），
   schema 无关，`openspec update --force` 实测 `git diff` 零改动；③
   `openspec schema validate spec-driven-with-adr` 过、`schema which` 解析到 `Source: project`。
   `schema fork` 这条路走不通（它只认 npm 包名，而该 schema 没发包），所以按文档走**项目级
   复制**到 `openspec/schemas/`。

3. **ADR 内容不改写、不删「作废/推翻」的记录。** 既有 9 篇只补 `Status` / `Date` /
   `Supersedes` 三行头（用户拍板），正文一字不改；新开的第 10 篇才用 `madr-minimal` 章节。
   风格偏好记在 `.agents/skills/architectural-decision-records/preferences.md`。
   **0011 与 0012 是局部修订不是整体取代**：两篇 `Supersedes` 都写 `none`，把 0011 整篇标成
   not-in-force 会丢掉「唯一端点 `POST /mcp`、被动到底」这些仍生效的约束。

4. **补三篇 spec 缺口**（0012/0015/0016），因为它们**零 requirement 覆盖**而都有测试钉着的
   常量：`MAX_RESULT_CHARS = 64 * 1024`、`MAX_TOOLS_PER_SERVER = 128`、
   `MAX_CALLS_PER_ROUND = 8`、五件工具的 root 边界。`docs/` 消失后，这些知识只剩 `adr/` 里的
   「为什么」，没有「必须怎样」——那才是规格该干的活。

5. **`page-actions.md` 拆两处，不整体塞进一个能力。** 候补控件的登记纪律归 `frontend`
   （主 spec「页面动作四处对齐」的「控件还没实现」场景本来就点名这个文件，所以连带做一条
   MODIFIED，否则删文件就留死引用）；两个开关的锚点与状态读法归 `site-dom`（站点 DOM 锚点
   契约）。**先按代码核对再写**：`src/lib/page.ts:264-340` 确认「按文字认控件、只认中文、
   `aria-pressed === "true"` 才算开、set 幂等且回达成态、`enabled` 非布尔回 `unknown-action`
   （`ACTION_ERROR_UNKNOWN` 的实际值），不是照文档抄的。**先前把候补表放进 `local-tools` 是
   归属错误，已撤。**

6. **`agents/` 三篇并进 `AGENTS.md` 后删文件，两段死内容不搬。** 指路变内联，文件就没有存在
   理由；而 `Wayfinding operations`（指向 `/wayfinder`）与 `domain.md` 里的
   `/domain-modeling`、`/grill-with-docs`、`/improve-codebase-architecture` 在本仓（含全局
   `~/.config/opencode` 与 `~/.agents/skills`）都不存在——没有消费者的指引是死引用，按清死
   代码那次（PR #57）的口径丢掉，记在 `adr.md` 的 Notes 里以备找回。`CONTEXT-MAP.md` 多上下文
   那半也不搬（本仓单上下文）。

7. **spec 里那些 `ADR-xxxx` 引用不受影响**——它们写的是编号（`ADR-0011`）不含路径，文件移动后
   仍解析得到。要改的只有**路径引用**：`conventions/spec.md:48` 与 `README.md:23/48`，以及
   `AGENTS.md` 的 Domain docs 节。

## Risks / Trade-offs

- [移出 `docs/` 后指路要一起改] —— 漏一处就留死引用。tasks 里逐项列出，并用
  `grep -rn "docs/adr\|docs/agents\|docs/page-actions"` 归零验收（只对活文件跑，change 自己的
  planning 文档里提到旧路径是历史叙述，归档后不管）。
- [`openspec validate` 不会校验 `adr/`] —— 这是**有意的**（它不是规格）。代价：ADR 里的数字
  可能与代码漂移。对策：ADR 里保留常量名与数值（如 `MAX_RESULT_CHARS = 64 * 1024`），`grep`
  一比就知道；而 spec 里的 requirement 才是被 CI 门守着的那份。
- [schema 是 CLI 标的 `experimental`] —— 升级可能变。对策：`openspec/schemas/` vendor 进仓，
  升级前跑 `openspec schema validate spec-driven-with-adr`。
- [已覆盖的 ADR（0002/0004/0010/0011/0013/0014）内容已在 spec 里，ADR 仍在 `adr/`] ——
  **有意的重复**：spec 是「必须怎样」（CI 守），ADR 是「为什么」（人读）。两者会漂，接受。
