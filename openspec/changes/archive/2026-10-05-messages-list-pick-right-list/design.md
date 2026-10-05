# Design: messages.list 在多个虚拟列表里挑对话那一个，并收下没有 key 的行

## Context

#54 报的是「`messages.list` 稳定回 `page-changed`，没法交叉验证真机行为」。2026-10-05
在票里那个会话（`613e11ee…`）复现到手：`send messages.list --params '{"timeout": 5}'` →
`{"ok":false,"error":"page-changed"}`。往下挖是**两层**，票里只写了第一层：

1. **挑错列表**。`conversation()`（`src/lib/messages.ts:393`）取 `document` 里**第一个**
   `ROW_SELECTOR` 命中的行，再 `.closest(LIST_SELECTOR)` 倒推它所在的列表——从不校验那是
   不是对话。真机上页面有**两条** `.ds-virtual-list`：
   - 主聊天区 `.ds-virtual-list--printable`（x=261、1209×742、自己就是滚动层、
     写作框 sticky 在里面）——**此刻 0 行**（`visible-items` 零子节点）；
   - 右缘一个 `position: fixed` 的 34px 窄条（悬停展开成 240×210 面板）——**3 行**，
     `data-virtual-list-item-key` 一个都没有，没有一行含 `.ds-message`。
     于是第一个命中行落在面板里，`conversation()` 认了面板。今天全站
     `document.querySelectorAll('[data-virtual-list-item-key]')` = **0**。

2. **没 key 的行被整片丢掉**。`sweepInto`（`:406`）是 `if (key === null || seen.has(key)) continue;`
   ——key 缺失的行连 `readRow` 都不进。#37（f1c6638，2026-10-04）给 `wait.*` 加了结构行锚
   与「无 key 行正文集合」，**`messages.ts` 的收集路径没跟上**。两处对不上是第二层。
   （票里建议 C 的前提是「`sweepInto` 不因 key 缺而弃行」，与代码相反，得改口径。）

配套事实（都在同一个隐藏页上量的，`document.visibilityState === "hidden"`）：
`.ds-message` / `.ds-assistant-message-main-content` / `.ds-collapsible-text` 全站 **0 个**；
`ROW_SELECTOR` 的结构位那条是 #37 按「新版行只剩哈希 class」加的，与今天量到的一致。

### 真机复验补上的两条（2026-10-05，`scripts/env-up.sh --debug` + `page-action.py`）

**① 隐藏标签页里站点根本不渲染对话**——新发一条消息后立刻量：URL 已跳到新会话、
`ds-virtual-list--printable` 在、写作框在列表里、`items` 的 `min-height` 已按内容算成
`280px`，而 `visible-items` **0 子节点**、`document.body.innerText` **不含**刚发的正文。
把窗口点到前台再量：同一页 `rows: 2 / keys: 2 / .ds-message: 2`、正文在 DOM 里。
所以先前那些「主区 0 行」「全站 0 个 key / 0 个 `.ds-message`」**是隐藏页的假象**，
不是「这个会话没渲染」。结论：读对话这条路**必须前台可见**，这是既有约束
（`nextFrame` 的 rAF 兜底注释里也写了），本次没有改它。

**② 因此「当前版本主列表的行带 key」**——前台可见时主列表 5 行、5 个
`data-virtual-list-item-key`、5 个 `.ds-message`；而右缘那个面板 6 行、**0 key / 0 `.ds-message`**。
这与 #37（f1c10-04）记的「新版行只剩哈希 class、没有 key」**对不上**。本 change **不去判定
站点是哪天换的版**，只保证两条路都认：key 在就按 key 去重（行为与今天完全一致），key 不在就用正文。
D4 的取舍因此是「为站点再换一次版留的门」，不是当前版本上正在发生的病。

**③ 现场复验（#54 那个会话，两条列表并存）**：`messages.list` 读到主列表那 2 条真消息
（user 的【ds 协议】+ `assistant` 的「收到」），`messages.last` 读到 `assistant` 的「收到」——
**没有**把面板那 6 行当成对话。修前同一页 `messages.list` 稳定 `page-changed`（已量到，见 proposal）。

**在册约束**：`adr/` 里 10 篇全 accepted、`Supersedes: none`（0011/0012 互相局部修订外），
没有一篇与本设计冲突；相关的是 ADR-0010「停机要说得出来」——本次照旧只出在册失败码、
不新增，也不拿空数组冒充读不到。spec 侧「只读渲染出来的 DOM（#20）」「只认语义与结构锚」
两条是硬边：判据只能取设计系统类 / 语义属性 / 结构位置，不能取哈希 class、不能取几何主判。

## Goals / Non-Goals

**Goals:**

- 页面上有多个 `.ds-virtual-list` 时，`messages.*` 与 `wait.*` 都认**对话**那一条；
  认不出就当场 `page-changed`，不猜。
- 没有 `data-virtual-list-item-key` 的行照样收进 `messages.list` / `messages.last`；
  就绪判据同样吃得到。
- 不改动作码、不改线协议、不改 fixture 形状；新对话回空数组的老口径保住。

**Non-Goals:**

- **不解释**「主区为什么 0 行」（隐藏页里站点不挂行 vs 这会话本就没渲染——两说都留着），
  也不为了让它挂行去动页面状态。
- **不动** `keysOf` / `settleUntilMounted`：全无 key 时它只按「行数变没变」判屏到了没有，
  可能多等几帧——**没有复现的证据**，真机若真冒出「扫不完这段对话」再开票。
- 不新增失败码、不碰 `protocol/fixtures/action.json`、不给 `wait.*` 换基线口径。

## Decisions

### D1：挑列表按三条语义锚，按序取首个命中

① 列表里装着写作框（`textarea, [contenteditable="true"]`，与 `page.ts:39` 同一个锚，
`COMPOSER_SELECTOR` 要 `export` 出来复用）→ ② 列表带 `ds-virtual-list--printable`
→ ③ 列表里有含 `.ds-message` 的行。三条都不中而页面上有行 → 当场 `page-changed`。

- **为什么写作框排第一**：写作框今天**就在主列表里**（真机：`_871cbca` 是 `.ds-virtual-list`
  的后代、sticky 在底部），而且它**不依赖行挂没挂**——主区 0 行的那一刻只有它能认出对话。
  「你往哪写，哪就是对话」也是语义锚，不是几何。
- **为什么 `--printable` 排第二**：设计系统修饰类（非哈希），代码注释里早把它当主列表
  （`hasReadableRow` 的 doc：「主列表 `.ds-virtual-list--printable` 的几何已完全就绪」），
  是写作框挪出列表时的兜底。
- **为什么 `.ds-message` 排第三**：最强的「这行是消息」证据，但今天全站 0 个 `.ds-message`
  ——**排第一会让现在这个页面直接判死**，所以只当最后兜底。
- **否决的替代**：
  - _按几何_（最大 / 不在 `fixed` 里 / 行最多）：`clientHeight` 在 jsdom 恒 0、真机随窗口变，
    且 spec 明写几何不当主判据。
  - _按 DOM 顺序倒推_（今天的做法）：正是 #54 的来路。
  - _收下所有候选列表、挑「有可读行」的那个_：主区 0 行时会挑中面板，把 240px 面板的行
    当成整段对话交出去——**比读不到更坏**（spec「角色三层解析」同一条理由）。

### D2：拆成两层——`conversationList()` 认列表，`conversation()` 认滚动层

- `conversationList(root)`：只做 D1 的挑法，回列表元素或 null。
- `conversation(root)`：签名与契约**照旧**（`ListViewport | null`，一行都没有 → null），
  但内部先 `conversationList()`，只在**对话列表**里找行走原来的「从行往上找到真滚得动的层」。
  `wait.ts` 不用改——它要的正是「行挂上了才拿到视口」，基线于是记在对话列表上。
- `readyWithin()` 改用 `conversationList()` 轮询：列表认得出但 0 行 → 等下一轮
  （行可能稍后挂）；认不出 → 当场 `page-changed`。行一旦挂上，下一轮 `conversation()`
  就从**行**推出真正的滚动层，就绪返回的视口与扫描用的是同一层。

### D3：进不进轮询按「页面上有没有行」，不按几何

`listMessages` / `lastMessage` 的早退条件从 `conversation(document) === null`
改成「任何 `.ds-virtual-list` 里都没有行 → 回空数组」：

- 新对话：哪儿都没行 → 老口径原样回 `[]`，快、对。
- #54 那个页面：面板里有行 → **不**回 `[]`，进轮询在对话列表上等；到点读不出 →
  `page-changed`（诚实），不再拿「没就绪」冒充「空对话」。
- `wait.ts` 那头不用动：`conversation()` 仍是「没行 → null」，`viewWithin` 照旧轮询到挂上才记基线。

- **否决的替代（这是本设计最容易走错的一步）**：用 `scrollsVertically(列表)` 当「有内容在」
  的门（`ds-virtual-list-items` 的 `min-height: 1680px` 撑出 1856>742）。它有两个硬伤：
  ① jsdom 里 `clientHeight` 恒 0、`overflowY` 不认——**行没挂的分支在单测里根本跑不到**，
  而 `hasReadableRow` 的注释正好警告过这条（「再加那条只会把 jsdom 无布局误判成页面没就位」）；
  ② 新对话那侧的几何（写作框 + 空态会不会撑到超一屏）**没验过**，门反了就是「新对话吃 25s
  轮询再报 page-changed」。而「有没有行」两边都不依赖布局、jsdom 直接可测。

### D4：没 key 的行用**正文**当身份

取舍说明：这是为「站点再换一次版」留的门。当前版本主列表的行带 key（见上面「真机复验补上
的两条」②），所以这条不改变任何真机行为；但 ROW_SELECTOR 早就按两版站点写了两条锚（#37），
收集路径却只认 key，那道缝留着迟早再踩一次。

`sweepInto` 改成 `key ?? rowText(row)`：有 key 用 key（老版，行为不变），没 key 用正文；
正文也空 → 不收。与 `wait.ts` 的基线（`keys` + `texts`）**同一口径**，一个仓里两套身份没道理。

- **否决的替代**：
  - _内容坐标_（`rect.top - viewRect.top + scrollTop`）：jsdom 所有 rect 都是 0，退化成正文，
    **单测验不出它多出来的分辨力**；真机上图片加载 / 折叠思考块会挪坐标，反而造重复。
  - _DOM 节点身份_（`Set<Element>`）：虚拟列表若回收复用节点，不同消息会共用一个节点被并成一条；
    跨「跳到底 → 跳回顶」重挂又是新节点，会重复。两种错都比正文的错更难发现。
  - _给 `data-virtual-list-item-key` 找替代属性_：全站 0 个 key、也没量到别的身份属性，
    属于编造锚点。

### D5：单测怎么补

`src/lib/messages.test.ts` 现有 fixture **全是带 key 的行**，两条路径都没被钉住。补三组，
结构照抄真机：

- **两条列表**：主列表（带 `--printable`、里面有 `textarea`、0 行）+ 右缘面板（行没 key、
  没 `.ds-message`、3 行）——断言 `conversation()` 认主列表、`messages.list` 不去读面板。
- **没 key 的行**：`visible-items` 直接子元素、哈希 class、无 key —— 断言照样进结果；
  老版带 key 的 fixture 一条不动，断言行为不变。
- **早退口径**：哪儿都没行 → `[]`；对话列表 0 行但别处有行 → 进轮询（注入假时钟 + 即时
  settle，沿用 `readyWithin` 现有的替身口）。

**实施时撞到两件与计划不同、已就地处理的事**（都记在这里，免得日后重踩）：

1. **jsdom 的 `querySelector` 在这里不可信**（nwsapi 坑）：页面上有**同类兄弟**
   （两条 `.ds-virtual-list`）且前一条的行是空的时候，任一条的 `querySelector(ROW_SELECTOR)`
   都回 `null`，而 `querySelectorAll(ROW_SELECTOR)` 是对的。真机 Chrome 没这毛病，但单测得可信——
   所以**存在性判断一律走 `querySelectorAll(...).length`**（`hasRow` / `firstRow`）。
   这也顺带解释了为什么「面板里有行、主列表 0 行」那个用例一开始静默走了空数组分支。
2. **两处既有 fixture 缺 `--printable`**，照新判据会「认不出对话列表」：`messages.test.ts` 的
   `conversationHtml()` 与 `wait.test.ts` 的 `listHtml()`。真机主列表两次实测都带这个类，
   所以是**把 fixture 补成真的**，不是给判据放水。补上后 `messages.test.ts` 里「行挂上、正文
   还没渲染」那条（#40 的语义）也保住了——① 写作框与 ② `--printable` 都与行内容无关，
   只有 ③ `.ds-message` 依赖渲染，所以它排最后是对的。

## Risks / Trade-offs

- [两条判据同时失效（站点把写作框挪出列表、又摘掉 `--printable`），只剩 `.ds-message`] →
  落到 ③ 或当场 `page-changed`；**不加几何兜底**——认不出就说认不出，比挑错列表好。
  换版先走 spec 的 `capture --codes` 那条路，不在这次里猜。
- [同正文的两条消息只留一条（D4 的已知取舍）] → 与 `wait.*` 基线同口径，spec 里明写成
  Scenario「两条正文一模一样」；`wait.*` 的注释已记「实测对话里少见」。
- [主区 0 行的真因没查清，修完可能**仍然**读不出来] → **未验证项**。判据与收集两条都修对了，
  主区挂不上行就不是这次的代码问题；真机复验要在**前台可见**的标签页上做
  （`visibilityState: hidden` 里 rAF 不来、站点挂不挂行都没准），仍不挂就按「换版先抓完整证据」
  落 `capture/` 再开票。
- [新对话几何未验，但 D3 已经绕开它] → D3 不看几何，这条风险在设计里被消掉；剩下的只是
  「别处有行」这个前提依赖侧栏不是虚拟列表——真机已量到侧栏不在 `.ds-virtual-list` 链上 ✓。
- [**导航刚落地那一瞬** `messages.list` 可能回 `[]`] → 真机上量到：点开 #54 那个会话后**立刻**
  读，两条列表都还没挂行，于是按 spec 的「哪儿都没行 → 空数组」回了 `[]`，而那一页是有消息的。
  这与修前行为一致（**非回归**），但确实是残余的「标错」面。要彻底消掉得能区分「新对话」与
  「有对话、行还没挂」——眼下只有几何（`ds-virtual-list-items` 的 `min-height`）分得开，
  按 D3 的理由（jsdom 不可测、新对话那侧没验过）本次不收。调用方要稳，用 `wait.reply` 等
  就绪类动作再读，或重试一次。
- [`settleUntilMounted` 在全无 key 时只看行数] → 无证据不动（Non-Goal），真机若报
  「扫不完这段对话」按票处理，不在本票夹带。

## Migration Plan

1. 单提交里落 `src/lib/messages.ts`（`conversationList` + `conversation` + `sweepInto` +
   早退口径）、`src/lib/page.ts`（`export COMPOSER_SELECTOR`）、`src/lib/messages.test.ts` 三组 fixture。
2. `pnpm quality`（vitest + pytest + prettier + ruff）与
   `openspec validate --all --archived --strict` 都绿。
3. `scripts/env-up.sh` 重建产物 + 重启 ds-browser（脚本自己保证跑的是最新代码），
   前台标签页上跑真机复验：票里那个会话 `messages.list` 不再 `page-changed`；
   `chat.new` 后 `messages.list` 仍秒回 `[]`。回滚 = revert 这一提交（无协议、无 fixture 形状改动）。

## Open Questions

- **未验证项 ①**：主区那 0 行是「隐藏页不挂」还是「这会话没渲染」——两说都留着，
  不写进 spec，只进复验步骤。
- **未验证项 ②**：新对话上 `.ds-virtual-list` 的几何与行数（D3 只依赖「哪儿都没行」，
  所以它不阻塞，但 `chat.new` 那一步要真量一次）。
- 没有 in-force ADR 需要推翻；本设计不产生新的持久架构决定（判据与身份口径落 spec 即可），
  `adr.md` 按 schema 记「无」。
