# site-dom（delta）

## ADDED Requirements

### Requirement: 多个虚拟列表里挑对话那一个

页面上出现**不止一个** `.ds-virtual-list` 时，`messages.*` / `wait.*` SHALL 认**对话**那一个，
判据按序取首个命中：① 列表里装着写作框（`textarea, [contenteditable="true"]`，与 `page.ts`
同一个锚）；② 列表带 `ds-virtual-list--printable`；③ 列表里有含 `.ds-message` 的行。
三条都不中而页面上有行 MUST 当场 `page-changed`，MUST NOT 退回「拿第一个命中行倒推最近的
`.ds-virtual-list`」——那是 #54 挑错列表的来路。三条判据 SHALL 都是语义 / 结构锚，
MUST NOT 把几何（宽窄、`position`）当主判据。

#### Scenario: 右缘还有一个虚拟列表

- **WHEN** 主聊天区那条 `.ds-virtual-list--printable` 装着写作框，右缘另有 `position: fixed`
  窄条展开出来的 240px 面板（行没有 key、没有 `.ds-message`），而行只挂在面板里
- **THEN** 认的是装着写作框的主列表，`messages.*` 不去读那个面板

#### Scenario: 三条判据都不中

- **WHEN** 认不出对话列表（没装写作框、不带 `--printable`、也没有 `.ds-message` 行）
  而页面上有行
- **THEN** 当场 `page-changed`，不猜也不倒推

#### Scenario: `wait.*` 的基线记在对话列表上

- **WHEN** `wait.*` 取基线
- **THEN** 扫的是对话列表里挂着的行；别的虚拟列表里的行不算进基线

### Requirement: 消息行没有 key 也照收

`messages.*` 收行 SHALL 记两种身份：行上挂着 `data-virtual-list-item-key` 就用 key
（老版，带符号、会话内不重复）；key 缺失就用该行的正文文本（与 `wait.*` 基线同一口径）。
MUST NOT 因为 key 缺失整片丢掉行——站点新版（2026-10-04 起）行只剩哈希 class、
没有 key，按 key 过滤等于一行都收不进。正文也为空的行（分隔条之类）SHALL 不收。

#### Scenario: 站点新版的行没有 key

- **WHEN** 对话列表里的行只有哈希 class、`data-virtual-list-item-key` 一个都没有
- **THEN** 这些行照样进结果，`messages.list` 不再因为「一行都收不进」报 `page-changed`

#### Scenario: 老版带 key 的行

- **WHEN** 行上挂着 `data-virtual-list-item-key`
- **THEN** 仍按 key 去重，跨屏重挂的旧行不算第二条，行为与今天一致

#### Scenario: 两条正文一模一样

- **WHEN** 两行正文完全相同（都没有 key）
- **THEN** 只保留第一条——正文当身份的已知取舍，与 `wait.*` 基线同口径

#### Scenario: 没 key 也没正文的行

- **WHEN** 行既没有 key、正文又为空（分隔条之类）
- **THEN** 不收进结果

#### Scenario: 就绪判据也吃这条

- **WHEN** 对话列表里挂着的行有正文但没有 key
- **THEN** 就绪判据认它（今天 `sweepInto` 把这些行全跳过，就绪永远为假、到点 `page-changed`）

## MODIFIED Requirements

### Requirement: `messages.*` 在预算内等就绪

`messages.list` / `messages.last` SHALL 在预算内轮询等**对话列表**就绪
（至少一行 `readRow` 读得出正文）；到点仍读不出才报 `page-changed`。
预算 SHALL 由 `params.timeout`（秒）决定，口径与 `wait.*` 一致：缺省 25、钳在 `[1, 25]`、
非法值按缺省。**就绪等待与扫描 SHALL 共用这一份预算**——就绪花掉的时间从扫描里扣，
不是各自独立计时，因此最坏耗时恒等于预算。

**进不进轮询按「页面上有没有行」定**：任何 `.ds-virtual-list` 里一行都没有 → 这是新对话，
回空数组，不轮询；页面上有行而对话列表还没挂行 → SHALL 进轮询（行可能稍后才挂），
MUST NOT 直接回空数组（那是拿「没就绪」冒充「空对话」）。

结构**真的变了**（认不出对话列表，判据见「多个虚拟列表里挑对话那一个」）MUST 照旧当场
`page-changed`，不进轮询。沿用 `wait.ts` 的预算轮询模式，不新增失败码。

#### Scenario: 列表晚挂载

- **WHEN** 动作到达时列表 / 滚动层还没挂好，且预算内又就绪了
- **THEN** 正常读出消息，不报 `page-changed`

#### Scenario: 到点仍读不出

- **WHEN** 预算耗尽仍读不出任何一行
- **THEN** 报 `page-changed`（这回是真的「结构变了」）

#### Scenario: 结构真的变了

- **WHEN** 认不出对话列表（三条判据都不中，而页面上有行）
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

#### Scenario: 虚拟列表里一行都没有

- **WHEN** 页面上任何 `.ds-virtual-list` 里都没有行（新对话）
- **THEN** `messages.list` 回空数组，不轮询、不报错

#### Scenario: 对话列表还没挂行，别处有行

- **WHEN** 对话列表此刻 0 行，而页面上另一个虚拟列表里挂着行，预算内对话列表挂上了行
- **THEN** 正常读出对话列表里的消息，不回空数组、也不去读那个有行的列表
