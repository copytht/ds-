## Context

`chat.switch` 在 #30 里被记过一句「本期不实现」，之后没有落到任何 spec 或 ADR 里——位置是「已核实
定位、待实现」。用户 2026-10-07 明确插件需要这个能力。

2026-10-07 真机实测（`scripts/page-action.py js`，只读渲染 DOM）得到的形状：

- 侧栏条目 `a[href^="/a/chat/s/"]`，真机 11 条，`tabindex="0"`，内含 `ds-focus-ring`、标题容器、
  以及一颗 `div[role=button].ds-button--iconLabelTertiary … _2090548`（悬停才显形的三点「更多」）。
- 标题容器 `div.c08e6e93` 是哈希 class；条目本身 `class="_546d736"`（选中或悬停时多挂一个哈希 class `b64fb9ae`，真机见过它出现又消失，两个起因没分清）。
- 分组容器 `div._3098d02` 内先有一行日期标签（如「7 天内」），再是条目 `<a>`。
- 真机侧栏有 5 条同名「列出工作目录文件」——按标题匹配不唯一。

约束：ADR-0018（登记最小单元须原样保留代码与图片、测试检查符合原样）；spec「控件定位优先设计
系统语义锚」（不碰哈希 class、图标不作判据）；`adr-0018-evidence` change 正在落地存证机制
（`protocol/evidence/controls.json` + 两侧对拍），本 change 依赖它。

## Goals / Non-Goals

**Goals:**

- 把 `chat.switch` 登记进候补 requirement，定位口径、形状陷阱、参数取舍都写清。
- 补 `sidebar.chat-row` 存证（ADR-0018）。

**Non-Goals:**

- 不写执行器、不进 `ACTION_ROSTER`、不改 `src/lib/page.ts`。
- 不动 `site-dom` 锚点。

## Decisions

### 1. 定位判据用 `a[href^="/a/chat/s/"]`，标题只作参数取值

会话 id 在 `href` 末段，是唯一且稳定；标题在同一元素内但容器是哈希 class。**否决**按标题文本定位
（重名，5 条同名）。**否决**按 `_546d736` 这类 class（哈希，改版即失效）。

### 2. 参数收两个：`title` 与 `id`，实现时按标题匹配后回读 `location.href` 核实

真机有 5 条同名会话，单靠标题会点到不确定的那条。实现的口径应是：按标题筛出候选 → 点第 N 个
（或按 `id` 直取）→ 回读 `location.href` 看落到了哪条，不符即 `page-changed`。这个核实动作是
实现阶段的登记内容，本 change 只把取舍写进 spec。

### 3. 存证记 `state-bound`

条目内嵌那颗 hover 才显形的「更多」按钮，`outerHTML` 在悬停前后不同，所以不是常驻态。
按 `adr-0018-evidence` 的存证形状记 `reconcile: "state-bound"`，对账时只报「当前态不符、未比」。
存的是**整条 `<a>`**（`sidebar.chat-row`），不是那颗 hover 按钮——`chat.switch` 的最小单元是条目，
hover 按钮是它的一部分，将来若要给「更多」做动作另立存证。

### 4. 不给「更多」按钮编动作名

它当前 hover 才显形、用途靠 tooltip，只记在存证里，**不进候补**——ADR-0018 与候补 requirement 都要求
认出用途才登记。

## Risks / Trade-offs

- [站点改版（条目结构变）] → 存证对拍会点名；`href` 前缀比 class 稳，改版时要重抓。
- [悬停态影响存证] → 记 `state-bound`，对账不比 `outerHTML`，只报态不符。
- [「更多」按钮被误认成独立动作] → spec 写死不编名。
- [登记了却不实现，可能长期挂着] → `chat.new` 已实现的对照下，实现本身很小；本 change 只负责把口径钉住。

## Open Questions

- 切换后要不要等消息列表渲染完成才算成功？这属实现阶段（可能要 `wait.*`），本 change 不定。
- 分组标签（「7 天内」）要不要进参数？不进——定位与参数都只用条目本身。
- 本 change 不引入新的长期架构决策。
