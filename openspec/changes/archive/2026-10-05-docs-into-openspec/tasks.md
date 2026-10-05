# Tasks

## 1. 换 schema 并装配套（试通后采用）

- [x] 1.1 vendor 社区 schema 进项目级 `openspec/schemas/spec-driven-with-adr/`
      （`schema fork` 只认 npm 包名、该 schema 没发包，故按其文档走项目级复制）。
      验证：`openspec schema validate spec-driven-with-adr` ✓ valid、
      `openspec schema which` → `Source: project`。
- [x] 1.2 `openspec/config.yaml` 的 `schema:` → `spec-driven-with-adr`。
      验证：`openspec status --change <新 change>` 报 `Schema: spec-driven-with-adr` 且 5 个
      artifact（`adr` 被 `design` 挡、`tasks` 要 `specs + adr`）。
- [x] 1.3 在飞的 `docs-into-openspec` 迁移标记：`.openspec.yaml` 的 `schema:` 同步改。
      验证：`openspec status --change docs-into-openspec` → `Schema: spec-driven-with-adr`、
      `Progress: 4/5`（旧 4 件都在，只欠 `adr`）——**旧 change 没被新配置破坏**。
- [x] 1.4 装 schema 声明的两个配套 skill（`architectural-decision-records`、
      `openspec-git-discipline`）到 `.agents/skills/`；`preferences.md` 记
      `preferred-style: madr-minimal`（用户拍板）。验证：两个 `SKILL.md` 存在、
      `preferences.md` 不再是 `unset`。
- [x] 1.5 确认 `.opencode/` 的 `/opsx-*` 命令不用重新生成：artifact 顺序读自
      `openspec status --json`。验证：`openspec update --force` 后 `git diff .opencode/` 为空。

## 2. ADR 归位与补头

- [x] 2.1 `git mv docs/adr adr`（仓库根，与 `openspec/` 平级——社区 `spec-driven-with-adr`
      的位置）。验证：`ls adr/*.md` = 10（9 迁移 + 新开 1）。
- [x] 2.2 既有 9 篇各补 `Status` / `Date` / `Supersedes` 三行头，**正文一字不改**；
      Date 取自 `git log` 该文件**旧路径**的首次入库日（rename 未提交时新路径查不到）。
      验证：`grep -c` 每篇恰好 3 行头，9/9 齐。
- [x] 2.3 检查篇间修订关系（`grep 修订|作废|推翻|supersede`）：只有 0012 局部修订 0011 一句，
      不是整体取代 → 两篇 `Supersedes` 都写 `none` 并注明，关系记进 `adr.md`。
      ADR 内部指向 `docs/adr` 的自引用：零命中。
- [x] 2.4 新开 `adr/0017-adrs-live-beside-openspec.md`（本次的长期承诺：ADR 落仓库根、
      换 schema、不可变靠 `Supersedes` 演进、spec 与 ADR 分工、风格 madr-minimal）。

## 3. 补 spec 缺口（delta 已写，archive 时并进主 spec）

- [x] 3.1 `backend` 新增 3 条：dsb 五件工作工具的边界 / 一次回答可排多块围栏 / 网关对交出去的
      东西封顶。验证：常量与代码一致——`dsb/gateway.py` 的 `MAX_RESULT_CHARS = 64 * 1024`、
      `MAX_TOOLS_PER_SERVER = 128`，`MAX_CALLS_PER_ROUND = 8` 在扩展侧。
- [x] 3.2 `frontend` 新增「页面动作的候补控件只登记、不进名册」，并 MODIFIED
      「页面动作四处对齐」——场景「控件还没实现」不再点名已删的 `docs/page-actions.md`
      （场景名一字不差，只改正文指向）。
- [x] 3.3 `site-dom` 新增「两个小开关按文字认控件」。**先按代码核对**：
      `src/lib/page.ts:264-340` 确认按文字认、只认中文、`aria-pressed === "true"` 才算开、
      set 幂等且回达成态、`enabled` 非布尔回 `unknown-action`。
- [x] 3.4 `conventions` MODIFIED「改协议要按清单同步动」：`docs/adr/` → `adr/`（整块替换，
      两个场景名原样）。

## 4. docs/ 内容归位、删文件、改引用

- [x] 4.1 `docs/agents/` 三篇并进 `AGENTS.md` 的「Agent skills」节（`gh` 用法、五标签表、
      文档地图改成 `CONTEXT.md` + `adr/`，并写明「接受过的 ADR 不改、推翻就新开一篇」）。
      验证：`AGENTS.md` 里 `gh` 用法与五个标签名都查得到。
- [x] 4.2 死内容不搬并记账：`Wayfinding operations`（指向 `/wayfinder`）与 `domain.md` 里的
      `/domain-modeling`、`/grill-with-docs`、`/improve-codebase-architecture`——本仓及全局
      都没有这些技能。理由记在 `adr.md` 的 Notes。
- [x] 4.3 删 `docs/page-actions.md` 与 `docs/agents/` 三篇；`docs/` 目录随之消失。
      验证：`ls docs` → 不存在。
- [x] 4.4 改路径引用：`README.md`（`见 docs/adr/0012` → `adr/0012`、目录树 `docs/adr/` →
      `adr/` 并补 `openspec/` 一行）、`AGENTS.md` Domain docs 节。
- [x] 4.5 归零验收：`grep -rn "docs/adr\|docs/agents\|docs/page-actions"` 对活文件
      （`*.md`/`*.ts`/`*.py`/`*.json`/`*.yaml`，排除 `openspec/changes/archive`）只剩两处
      **待 archive 生效**的主 spec 引用（`frontend/spec.md:138`、`conventions/spec.md:48`），
      两处都已由本 change 的 MODIFIED delta 覆盖，archive 后归零。

## 5. adr.md 审阅清单

- [x] 5.1 写 `openspec/changes/docs-into-openspec/adr.md`：列出 9 篇在作数的 ADR 与相关性、
      新开的 0017、以及 0011/0012 局部修订的说明与死内容不搬的记录。

## 6. 门

- [x] 6.1 `pnpm quality` 全绿（**本 change 不改代码**，只确认没碰坏）。验证：退出码 0，
      vitest 491、pytest 143，与 main 相同。
- [x] 6.2 `openspec validate --all --strict` 与 `openspec validate --all --archived --strict`
      都过。（7 passed / 5 passed；prettier 抓到 7 个文件，其中 4 个是我写的→`--write` 修，
      3 个是 vendor 的上游 schema→加进 `.prettierignore`，否则每次升级都跟上游 diff 不上。）
- [x] 6.3 `/opsx-archive docs-into-openspec`：`backend` +7、`frontend` +1 与 1 条 MODIFIED、
      `site-dom` +1、`conventions` 1 条 MODIFIED 并进主 spec（同步由 agent 逐条合并，
      校验 delta ↔ 主 spec 的 11 条 requirement 与全部场景一一对应）。
      验证：`grep -rn "docs/adr\|docs/agents\|docs/page-actions"` 对活文件只剩 **3 处历史叙述**
      （`adr/0017` 记「当时 docs/ 里有什么」、`preferences.md` 记「原 `docs/adr/`」），
      **指向文件的活引用 0 处**——`README.md`、`AGENTS.md`、`conventions` 主 spec 都已改。
      **同步时按 validator 口径拆过**：主 spec 惯例是「正文 ≤500 字、不用表格」（场景不计入），
      我初稿 3 条超长（2413/713/659 字）且带 2 张表 → 拆成 7 条、表改成按控件组分场景，
      `validate --specs` 现在零 INFO。
- [ ] 6.4 开分支、提 PR、等 CI 全绿（**合并 `gh pr merge --merge` 与删分支是 PR 的收尾操作，
      不属本 change 的任务**——否则勾不到，先勾就是说谎）。

## 回滚点

- ADR 移位、`docs/` 删文件、schema 换配置都可 `git revert`（内容全在 git 历史里），无运行时风险。
- 4.5 那两处主 spec 引用与 6.3 必须一起成立：只 revert 其中一边就留死引用。
