# 站点 DOM 锚点契约（chat.deepseek.com）

## Purpose

让扩展在**只读页面渲染出来的 DOM** 的前提下，稳定地读出对话内容、判出消息角色、等到新消息，
并在站点换版时有一套可复现的排查与落测流程。

## Requirements

### Requirement: 只读渲染出来的 DOM

读对话与等动作 SHALL 只读页面渲染出来的 DOM；MUST NOT hook 站点的请求 / 响应体、
解析站点消息 JSON、或直连站点接口（#20 的口径）。

#### Scenario: 需要消息正文

- **WHEN** `messages.*` / `wait.*` 取正文
- **THEN** 只从 DOM 取（含把 `<pre>` 还原成围栏），不发任何站点请求

### Requirement: 换版先抓完整证据

站点换版时 SHALL 先抓「完整的它」再下判断：`scripts/env-up.sh --debug` 起带调试口的浏览器，
再 `uv run scripts/page-action.py capture --codes` 落 `captures/<时间戳>/`。

#### Scenario: 换版排查

- **WHEN** 观察到锚点失效
- **THEN** 先捕获 `page.html` / `styles.css` / `assets.json` / `digest.json` / `ax.json` / `codes/`
- **AND** 先读 `codes/`（站点的真实规则在里面）再改判据
- **AND** `captures/` 不进版本库（`.gitignore` 里有）

#### Scenario: 不用零散探针拼结论

- **WHEN** 只用零散探针读页面（2026-10-04 的教训：读出「`.ds-*` 全没了」，其实只是量到了另一条小面板列表）
- **THEN** 结论作废，改用完整捕获重来

### Requirement: 只认语义与结构锚，不碰哈希 class

锚点 SHALL 取自站点的设计系统类、语义属性（`role` / `aria-*` / `data-*` key）或稳定结构位置；
MUST NOT 依赖随部署变化的哈希 class（`_81e7b5e` / `_9663006` 这类）。

#### Scenario: 认消息行

- **WHEN** 站点两版行标记并存（老版挂 key、新版只剩哈希 class）
- **THEN** 行锚是两条并列：`[data-virtual-list-item-key], .ds-virtual-list-visible-items > *`

#### Scenario: 认列表容器

- **WHEN** 需要列表层与滚动层
- **THEN** 只认 `.ds-virtual-list` / `.ds-virtual-list-items` / `.ds-virtual-list-visible-items`

### Requirement: 圆键两态同元素

站点把「发送」与「停止」压进**同一个** DOM 元素：写作框旁的圆键
（`div[role="button"].ds-button--primary.ds-button--filled.ds-button--circle`）在生成期原地
变停止键——`class` 一个不换、`aria-label` 为空，只有 `svg path` 的 `d` 不同（箭头
`M8.3125 0.980206…` = 发送、方块 `M2 4.88C2 3.68009…` = 停止，两者同为 16×16）。真机
2026-10-04 抓取两次（生成中 / 空闲），落成 `src/lib/page.test.ts` 的回归常量。

这是**站点形状**，记在这里供换版时比对；MUST NOT 被吸收成我们的契约（名册按控件分，
见 `frontend` 的「一个按钮一个动作」）。

#### Scenario: 生成期原地换图标

- **WHEN** 生成开始，圆键里的箭头换成方块
- **THEN** 元素引用不变、`class` 不变、`aria-label` 仍为空，只有图标 `d` 变

#### Scenario: 思考期环形 spinner

- **WHEN** 页面在思考期，圆键位置显示一个环形 spinner（真机 2026-10-05 抓）
- **THEN** 它是 `<div class="ds-loading">` 里的 `<svg viewBox="0 0 36 36" data-icon="spin">`，
  **带 `ds-button--disabled`**——所以可用性判据就挡住点击，`button.get` 报 `unknown`
  （图标既非箭头也非方块）。真机 DOM 落成 `src/lib/page.test.ts` 的回归常量

### Requirement: 角色三层解析

消息角色 SHALL 按「标记层 → 渲染层（气泡） → `unknown`」解析，首个命中为准；
认不出时 MUST 回 `unknown`，**不猜**（标错角色比读不到更坏，agent 会拿它当上下文）。

#### Scenario: 标记层还在

- **WHEN** 行里有 `.ds-assistant-message-main-content` 或 `.ds-collapsible-text`
- **THEN** 直接判 `assistant` / `user`（零回归）

#### Scenario: 用户行（渲染层）

- **WHEN** 行里没有角色类，且有一个圆角 ≥ 16px、左缘不贴行左缘的绘制块（真机用户气泡：
  `border-radius: 22px`、底色 `rgb(237, 243, 254)`、不满宽）
- **THEN** 判 `user`

#### Scenario: 用户行（头像兜底）

- **WHEN** 行内有圆角 ≥ 100px 的绘制块（真机 30px 头像圆）
- **THEN** 判 `user`

#### Scenario: 助手行

- **WHEN** 行里没有角色类，且一个绘制块都没有（整宽素文）
- **THEN** 判 `assistant`

#### Scenario: 助手内容块不算气泡

- **WHEN** 助手行里有一个满宽、`border-radius` 约 12px 的绘制块（代码块 / 表格也绘底色）
- **THEN** 不判成 `user`

#### Scenario: 判不出

- **WHEN** 行宽为 0（未挂载 / jsdom 不布局），或没有任何线索
- **THEN** 回 `unknown`

#### Scenario: 颜色不作判据

- **WHEN** 暗色主题下底色全变
- **THEN** 判据只用形状 + 位置 + 头像，不用颜色

#### Scenario: 不做载荷层

- **WHEN** 站点消息模型自带 `chat_message_role`（抓代码读得到）
- **THEN** 仍 MUST NOT 用它当源——用要改 #20 口径 + 多一条跨世界管子，而「角色认不出」一次都没复现

### Requirement: `wait.*` 的新行按集合判

`wait.*` SHALL 用「基线里没见过」判定新行：基线记行的 key 集合 + 无 key 行的正文集合；
MUST NOT 比较 key 的数值大小。

#### Scenario: 带符号的 key

- **WHEN** 行 key 带符号且一个来回两条同值不同号（真机样本 `-2` 问题 / `2` 围栏 / `-4` 回灌 / `4` 答复）
- **THEN** 只认基线里没见过的 key / 正文（`key > 基线` 漏负 key；`|key| > 基线` 漏同来回的对面那条）

#### Scenario: 滚动重新挂出的旧行

- **WHEN** 视口滚动后重新挂出已见过的行
- **THEN** 其 key / 正文都在基线里，不算新消息

### Requirement: `wait.*` 等挂载，不当场报错

`wait.*` SHALL 在预算内轮询等列表挂出来；到点仍没有才是 `page-changed`；等不到新消息是
`timeout`。两者 MUST 分开。

#### Scenario: 列表晚挂载

- **WHEN** 动作到达时列表还没挂上（首页发完第一条要跨一次导航才挂），预算内又挂上了
- **THEN** 正常继续，不报 `page-changed`

### Requirement: 围栏还原，外框里只有 `<pre>` 算正文

读行文本时 SHALL 把 `<pre>` 还原成一段围栏：正文能 `parseToolCall` 就写成 **send 围栏**，
否则写普通围栏。代码块外框里除 `<pre>` 之外的兄弟（表头 / 复制下载按钮 / 图标）
MUST NOT 进正文。

#### Scenario: 站点把 send 围栏渲染成代码块

- **WHEN** 结构为 `div.md-code-block` → 表头 / `<pre>` / 图标（原文的三反引号标记没了）
- **THEN** 正文是 send 围栏 + `<pre>` 内容，没有「send / 复制 / 下载」这类控件文字
- **AND** 该文本 `parseSendFence` 照样认

#### Scenario: 正文夹着代码块

- **WHEN** 助手正文是「段落 + 代码块 + 段落」
- **THEN** 两段正文都保留，只有代码块外框里的控件被排掉

### Requirement: 工具调用解析住在围栏域

`parseToolCall` / `MALFORMED_CALL_HINT` SHALL 住在 `src/lib/fence.ts`；`src/lib/relay.ts`
转出它们，中继那条线的调用方照旧从 `./relay` 取。

#### Scenario: 读 DOM 那半边也要解析

- **WHEN** 还原围栏需要判「正文是不是工具调用」
- **THEN** 从 `fence.ts` 取 `parseToolCall`

### Requirement: 站点变了先红单测

改锚点 SHALL 在同一次提交里补照抄真机结构的 fixture（`messages.test.ts` / `wait.test.ts`）；
真机复验（`scripts/env-up.sh --debug` + `scripts/page-action.py`）是最后一道。

#### Scenario: 下次换版

- **WHEN** 站点再换版
- **THEN** 单测与真机复验先红（fixture 里是真机结构，不是编的形状）

### Requirement: `messages.*` 在预算内等就绪

`messages.list` / `messages.last` SHALL 在预算内轮询等消息列表就绪
（至少一行 `readRow` 读得出正文）；到点仍读不出才报 `page-changed`。
预算 SHALL 由 `params.timeout`（秒）决定，口径与 `wait.*` 一致：缺省 25、钳在 `[1, 25]`、
非法值按缺省。**就绪等待与扫描 SHALL 共用这一份预算**——就绪花掉的时间从扫描里扣，
不是各自独立计时，因此最坏耗时恒等于预算。结构真的变了（`conversation()` 根本找不到列表）
MUST 照旧当场 `page-changed`，不进轮询。沿用 `wait.ts` 的预算轮询模式，不新增失败码。

#### Scenario: 列表晚挂载

- **WHEN** 动作到达时列表 / 滚动层还没挂好，且预算内又就绪了
- **THEN** 正常读出消息，不报 `page-changed`

#### Scenario: 到点仍读不出

- **WHEN** 预算耗尽仍读不出任何一行
- **THEN** 报 `page-changed`（这回是真的「结构变了」）

#### Scenario: 结构真的变了

- **WHEN** `conversation()` 根本找不到列表（锚点失效）
- **THEN** 当场报 `page-changed`，不进入轮询

#### Scenario: 两段预算共用一份

- **WHEN** `messages.list` 给了 `timeout: 25`，而就绪等待花掉了 5 秒
- **THEN** 扫描只剩 20 秒可用，最坏总耗时 25 秒——不会被中继的锁吞成 `timeout`

#### Scenario: 预算按入参钳位

- **WHEN** `timeout` 缺省、非法（非数 / NaN）、超上限或低于下限
- **THEN** 分别按 25 / 25 / 25 / 1 秒处理，与 `wait.*` 同一套 `parseWaitSeconds` 口径

#### Scenario: last 与 list 同一口径

- **WHEN** `messages.last` 也传 `timeout`
- **THEN** 同样被接受并照此定预算，不因为「只读最后一屏」就另立特例
