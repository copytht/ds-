# Implement — stop.click + chat.new（页面动作 7/8）

> 规划件；`task.py start` 之后再动产品代码。第 0 步是真机探测（需人配合），其结果决定
> `src/lib/page.ts` 里选择器常量的确切写法。

## 0. 真机探测（人配合，产选择器 + 回归 DOM）

前提：ds-browser 已开（`scripts/env-up.sh`）、**账号未禁言**、能发起一次生成。禁言则记下，
跳过本步、走「未确认」路径（见下）。

在 ds-browser 的 `chat.deepseek.com` 标签页：**先发一条会持续生成的消息**（如「写一篇 800 字
散文」），**生成中**打开 DevTools 控制台粘贴下面这段（只读，不改页面）跑一次；再在**空闲**
时跑一次。两次输出都贴回。

```js
(() => {
  const info = (el) => {
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(),
      class: typeof el.className === "string" ? el.className : "",
      role: el.getAttribute("role"),
      ariaLabel: el.getAttribute("aria-label"),
      ariaPressed: el.getAttribute("aria-pressed"),
      title: el.getAttribute("title"),
      text: (el.textContent || "").trim().slice(0, 30),
      box: Math.round(r.width) + "x" + Math.round(r.height),
      outerHTML: el.outerHTML.slice(0, 500),
    };
  };
  const nodes = [
    ...document.querySelectorAll('div[role="button"], button, [role="button"], [aria-label]'),
  ];
  const buttons = nodes.map(info).filter((x) => x.box !== "0x0");
  const SEND =
    'div[role="button"].ds-button--primary.ds-button--filled.ds-button--circle';
  const send = document.querySelector(SEND);
  const sendContainer =
    send && send.parentElement ? send.parentElement.outerHTML.slice(0, 1500) : null;
  return JSON.stringify(
    { url: location.href, sendPresent: !!send, sendContainer, buttons },
    null,
    1,
  );
})();
```

判据：

- 比「生成中」与「空闲」两次 `sendContainer` / `buttons`：只在生成中出现、且尺寸正常、可点的
  那个键就是停止键。
- 若生成期发送键**整个消失**、原地换成另一个键 → 停止键是独立元素，按它的 `class` /
  `aria-label` 定选择器。
- 若生成期**同一个圆键**外形变了（仍是 `ds-button--circle` 一族）→ `stop.click` 就是「此刻的
  发送键」，实现里复用 `SEND_SELECTOR` 语义（但**不**做禁用判定）。
- 把停止键的 `outerHTML` 原样存下来，第 4 步落成回归用例。

**未确认路径**（账号禁言 / 无生成）：选择器先按 design.md 的策略写（语义属性优先，退回
`ds-button--circle` 族），代码注释与提交信息显式标「未经真机确认」；验收第 1 / 3 / 6 条标
未做，等账号可用补一次。

## 1. `src/lib/page.ts`：执行器

- 加停止键选择器常量（按第 0 步结果；与 `SEND_SELECTOR` 并列）。
- 加 `findStopButton(): HTMLElement | null`：按选择器找、渲染出来（`getClientRects().length`）
  才算数；不做发送键那套 `ds-button--disabled` 判定（那是发送键的语义）。
- 加 `stopClick(_frame: ActionFrame): Record<string, never>`：找不到抛
  `PageError(ACTION_ERROR_PAGE_CHANGED, "停止键不可用")`，命中就 `el.click()`，返回 `{}`。
- 注释写清「只在生成中出现」「不碰哈希 class」与真机确认结论。

## 2. `entrypoints/content.ts`：登记名册

- `import` 里加 `stopClick`；`ACTION_ROSTER` 在 `"send.enter"` 后加 `"stop.click": stopClick`。

## 3. `src/lib/action.ts`：退避闸归属

- `BACKOFF_GATED_ACTIONS` 加 `"stop.click"`（与 `chat.new` 同口径：改变页面状态）。**不加**进
  `SPEAK_GATED_ACTIONS`（不动写作框）。

## 4. `protocol/fixtures/action.json` + 测试

- fixture：在「chat.new 成功」后加「stop.click 成功」样例（`action:"stop.click"`, `params:{}`,
  `target:"42"`, 响应 `{ok:true,result:{}}`）。
- `src/lib/page.test.ts`：
  - 命中：真停止键 HTML → `stopClick` 派发一次 click；
  - 找不到 → 抛错（`page-changed`）；
  - **回归用例**：第 0 步抓到的真机 `outerHTML` 原样进 jsdom，断言 `findStopButton()` 命中
    （若走未确认路径则省略，标 TODO）。
- `src/lib/action.test.ts`：加「stop.click 也在退避闸下」一条，对齐 `chat.new`（`:468`）。

## 5. 验证命令

```sh
pnpm test                         # vitest 全量（含新增用例）
pnpm quality                      # lint + typecheck + test + format + ruff + pytest，两半一起过
```

真机人工确认（第 0 步同一次即可顺手做）：

- `chat.new`：点侧栏「开启新对话」，看地址栏 url 变化。
- `stop.click`：若能在生成中经扩展名册触发则点一次；否则以「真机 DOM 回归用例绿」作为选择器
  确认证据。

## 6. 收尾

- 若探测学到可复用的「停/发同族选择器」口径，`trellis-update-spec` 记进
  `.trellis/spec/frontend/`（质量 / 目录结构相关）。
- 提交（Phase 3.4）；子任务独立归档，父 issue #21 关。

## 回滚点

- 按文件回退：`page.ts` → `content.ts` → `action.ts` → `fixture` → 测试。
- 无数据 / 配置迁移；无 dsb 侧改动。

## 起手前检查

- [ ] `prd.md` / `design.md` / 本文件齐。
- [ ] `implement.jsonl` / `check.jsonl` 有真实条目（子 agent 上下文）。
- [ ] 真机探测的两次输出已拿到（或明确走未确认路径）。
- [ ] 用户明确批准本 plan 后，才 `task.py start`。
