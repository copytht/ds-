## Context

ADR-0018 要求：制作页面动作最小单元时原样保留按钮的代码与图片，并由测试检查符合原样。读代码得到的现状：

- `src/lib/page.test.ts`：圆键三态 `STOP_BUTTON_HTML` / `SEND_BUTTON_HTML` / `SPINNER_BUTTON_HTML` 是真机
  `outerHTML` **手抄成字符串常量**（含完整 `svg path`，注释标日期）——原样，但没人对拍。
- `src/lib/messages.test.ts` 第 141 行起的代码块 fixture 是**缩写**（`<div role="button" class="ds-button"><span>复制</span></div>`），
  与 2026-10-06 真机（`ds-button--borderlessNeutral … --xs`、图挂 `ds-button__icon`、整组在
  `md-code-block-banner-wrap` 下）对不上账。
- 2026-10-06 的真机爬取产物在 `captures/`（已 gitignore、本机也已不在），**没有任何一颗按钮的原件留在仓里**。
  所以代码块等必须真机重抓一次。
- 两半对拍的先例：`protocol/fixtures/*.json` 由 `src/lib/fixtures.ts` 的加载器与 `tests/conftest.py` 的 `load_fixture`
  共读，`fixtures.test.ts` 与 `test_fixtures.py` 各持一份完整性检查。
- `scripts/page-action.py` 已有 `js` 子命令（页面上下文跑只读 JS）与 `pace()` 限速；探针不 dispatch 事件的边界已写在 spec。
- 约束：不改 `ACTION_ROSTER`、不改执行器；`src/**` 不碰 console、不直接访问站点；脚本过 ruff。

## Goals / Non-Goals

**Goals:**

- 一个存证文件，原件住文件、用例从文件读；缩写与手抄没有落脚点。
- 进 `pnpm quality` 的两侧对拍（TS + pytest）。
- 一个真机对账子命令：站点当前 vs 留档，逐字比。
- 把现有手抄 / 缩写的用例迁到存证（圆键三态、代码块）。

**Non-Goals:**

- 11 项候补的存证与实现（另开 change）。
- 不把图标 `path` 当定位判据，不改定位口径。
- 不做截图存证（ADR 只在 `svg` 拿不到时才要，本批都拿得到）。
- 不把真机对账塞进 CI。

## Decisions

### 1. 存证放 `protocol/evidence/controls.json`，一个文件、条目数组

`protocol/` 已是两半共读的地盘，加载方式有先例。**否决**放 `src/lib/__fixtures__/`——pytest 够不着；
**否决**一颗一个文件——十几颗时目录噪声大，且对拍要的「唯一 id」在单文件里更好查。
`protocol/fixtures/` 里的 `*.json` 有 `EXPECTED_FILES` 的清单测试，存证是另一类东西（原件，不是用例输入输出），
所以另开 `protocol/evidence/` 目录，不混进 `fixtures/` 的清单。

条目形状（字段语义见 spec）：

```json
{
  "id": "circle.stop",
  "capturedOn": "2026-10-04",
  "reconcile": "state-bound",
  "row": null,
  "probe": "(() => { … return el ? el.outerHTML : null })()",
  "outerHTML": "<div role=\"button\" class=\"ds-button …\">…</div>",
  "svgs": [{ "viewBox": "0 0 16 16", "paths": ["M2 4.88C2 3.68…"] }]
}
```

### 2. 「完整性」的判据：`svgs` 必须能从 `outerHTML` 里**独立解析**出来

「不许缩写」要机器可查，就不能只查「字段在」。判据：把 `outerHTML` 解析出来，抽每个 `svg` 的 `viewBox` 与全部
`path` 的 `d`，与 `svgs` 逐项相等；再查 `capturedOn` 合法、无 `…` / `...` / `<!--` 占位、parse 后 tag 成对。
这样缩写要么改 `outerHTML`（于是 `svgs` 不等而红）、要么两处同改（那就是有意的重抓）。
TS 侧用 jsdom（vitest 已是 jsdom 环境），Python 侧用标准库 `html.parser`——两半各自独立实现同一判据，
不共用代码（与 fixtures 对拍同理：互相对不上就红）。**否决**只比字符串长度 / 哈希——换个等长的假内容就过了。

### 3. 「不许手抄」靠扫源码，不靠自觉

对拍测试读所有 `src/**/*.test.ts`，若任何一份的源码里含存证里某条 `path` 的 `d` 原文就判红
（存证文件自己不在 `*.test.ts` 内，不误伤）。用例改走 `evidenceHtml(id)`（`src/lib/evidence.ts` 里只做读 + 按 id 取，
不碰 console、不碰站点）。取到后允许 `.replace()` 做最小变形（现有用例已这么用：`STOP_BUTTON_HTML.replace("M2 4.88", …)`——
注意这条 `replace` 的字面量是 `path` 的**前缀**，不是整条，不触发判据；判据要求的是整条 `d` 出现）。

### 4. 真机对账是 `page-action.py evidence`，探针表达式随存证走

`probe` 放在条目里，对账子命令对 `reconcile: live` 的条目：走 `ensure_site_tab()` → `run(probe)` → 与 `outerHTML` 逐字比；
不等就打印 `id` + 首个差异位置前后的片段 + 「站点改版，存证过时」，退出码 1。`state-bound` 的条目（圆键只在某态
出现）：probe 返回的与存证不等时只报「当前态不符、未比」，不算过时。沿用 `pace()`，不 dispatch 事件。
`--id` 可只比一条。**否决**把定位器写进脚本的字典——存证与它的定位器分居两地，改一边会忘另一边。
`probe` 只是对账用的探针，**不是**执行器的定位判据（spec 已写）。

### 5. 本 change 入档哪几条存证

只入档**已经被现有用例用到的**，且可在不点任何按钮的前提下抓到的：

- `circle.stop` / `circle.send` / `circle.spinner`：现有手抄常量原样搬入（日期取注释里的 2026-10-04 / 2026-10-04 / 2026-10-05，`state-bound`）；
- `code.block`：整块 `div.md-code-block`（回补 `messages.test.ts` 的缩写 fixture 要用，**真机重抓**，`live`）；
- `code.copy` / `code.download`：块内两颗按钮（`row`：父容器 `md-code-block-banner-wrap`，同排 2 颗，第 1 / 2 颗）。

另 11 项候补里的消息工具栏 / 页头 / 侧栏**不在本 change 入档**——它们随各自的实现一起入档
（ADR-0018：「实现时原样搬进回归用例」）。代码块那三条之所以现在入档，是因为 `messages.test.ts` 的回补要用。

### 6. 代码块回补要核对 `readRow`

回补成真实结构后，`readRow` 必须仍把表头与复制/下载按钮当作 `<pre>` 的兄弟、不算正文（现有用例的断言）。
若真实结构下不成立，那是**缺陷**：先在票里记，不在本 change 里悄悄改执行器；本 change 只改测试的取材。

## Risks / Trade-offs

- [存证会过时（站点改版）] → 真机对账子命令点名过时的 `id`；每条带 `capturedOn`；ADR-0018 已承认「最强证据不是每次提交都有」。
- [对账误报：`live` 条目的 `outerHTML` 带状态属性（`aria-disabled`、hover/focus class）] → 抓取与对账都在「静止」态
  （不悬停、不聚焦）；`probe` 可返回去掉瞬态后的同一份；遇到误报按 `state-bound` 降级并在条目里记原因，不放宽比较规则。
- [判据 3 的扫源码法对「分段拼接 path」无效] → 接受：这是防手滑的栅栏，不防蓄意绕过；评审仍要看。
- [重抓代码块需要登录态 + 一条含代码块的会话] → 前置写进 tasks；抓不到就停在该任务，不拿缩写顶。
- [`protocol/evidence/` 体积] → 本批 6 条、几 KB；11 项候补入档后仍是十几 KB 量级，可接受。

## Open Questions

- 对账时 `outerHTML` 的比较要不要对 `style` 里的瞬态值（`--dsl-button-height` 之类）网开一面？当前决定：不开，
  出现误报再议。
- `evidenceHtml` 放 `src/lib/evidence.ts` 还是并入 `fixtures.ts`？当前倾向单独文件（「一主题一文件」）；
  因为 `src/lib/fixtures.ts` 管的是 `protocol/fixtures/`，存证是另一类。
- 本 change 不引入新的长期架构决策（ADR-0018 已承载）。
