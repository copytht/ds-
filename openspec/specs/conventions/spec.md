# 跨层思考与工作方式约定

## Purpose

定本仓库跨包、跨层的思考规矩：写新逻辑前先找现成的、改协议时知道有几处要一起动、
以及**人很容易做到就优先用人的方式**这条判据取向。

## Requirements

### Requirement: 写新逻辑前先找

落笔前 SHALL 先按既有主题找一遍近亲：解析跨边界载荷 → `channel.ts` 的 `parse*`；
构造消息 → 同文件的 `*Message()`；定时器 → `wait.ts` / `watchdog.ts`；退避 → `backoff.ts`；
唯一 id → `id.ts`；storage 键 → 各模块常量；与 MCP server 说话 → `relay.ts` / `gateway.py`；
拼协议说明 → `instructions.ts`；失败码 → 三本册子。

**发消息到页面** MUST 按「哪一条路」分别找近亲，MUST NOT 当成一件东西：自动续聊 →
唯一出站口 `gate.ts`（ADR-0002，窗口 3–5 秒）；手动页面动作与看门狗催办 → `runAction` →
`page.ts`（受「代你发言」闸与退避闸，**不经** `gate.ts`）。归属见 `continuation` 能力的
「出站窗口是自动续聊这一路的收口」。

#### Scenario: 想写一个新 parse / 一个新信封

- **WHEN** 要解析或构造跨边界载荷
- **THEN** 先用现成主题里的 `parse*` / `*Message()`，没有才新建

#### Scenario: 要发消息到页面

- **WHEN** 要新写一条「把消息送进页面」的路
- **THEN** 先问它是续聊（排进 `gate.ts` 队列、受 3–5 秒窗口）还是手动/催办（走 `runAction`
  的动作与闸）；MUST NOT 因为「都是发消息」就当成同一条路——2026-10-05 实测就是这么长出
  第二条绕过出站口的路径的（#48）

### Requirement: 语义相同不等于可以复用

复用的 SHALL 是「过 parse」这条纪律，不是函数本身；为复用而抽象是反模式——本仓库没有抽象工厂、
没有基类，只有主题文件。复用到第三处才值得抽成独立文件。

#### Scenario: 两个形状不同的解析

- **WHEN** 两处需求语义相同但形状不同
- **THEN** 各写各的 parse

### Requirement: 改协议要按清单同步动

改任何线协议（围栏内容、chain 消息 kind、runtime 消息类型、失败码、工具目录）时 SHALL 逐项同步：
`protocol/fixtures/*.json`、扩展侧构造 / 解析与类型（成对加）与 `*.test.ts`、中继侧对应语义与
`tests/test_*.py`、以及 `CONTEXT.md` 词条 / `docs/adr/` / 本 spec 相关篇。

#### Scenario: 少改一处

- **WHEN** 只有一边改了
- **THEN** `pnpm quality` 里的 fixture 对拍变红（设计如此，不是麻烦）

#### Scenario: 先加字段后补语义

- **WHEN** 在 fixture 里加「以后再用」的字段
- **THEN** 判不合格（对拍会要求两边立刻有语义）

### Requirement: 方向性纪律

只有 background SHALL 打网络（`src/lib/relay.ts`）；MAIN 与隔离世界 MUST NOT fetch，
dsb MUST NOT 下发 CORS 头；dsb SHALL 完全被动（不推送、不轮询、无会话，ADR-0011）；
失败提示 MUST NOT 进对话流（只有「有回话」才回灌，ADR-0010）。

#### Scenario: 需要现场

- **WHEN** 扩展侧要站点 / 中继的现场
- **THEN** 由扩展周期探活（`ping`）或按需 `tools/list`（缓存 60s，坏数据沿用旧表）

#### Scenario: 改协议不改词条

- **WHEN** 改了 `CONTEXT.md` 里点到协议的词条却没更新它
- **THEN** 判不合格（下一个会话的 agent 会按旧词想事）

### Requirement: 人很容易做到就优先用人的方式

做判断 / 操作页面之前 SHALL 先问「人在这儿是怎么做的？」——人看的信号（样子、位置、顺序）
通常落在**渲染结果**里，而不是实现细节（class 名、内部状态、接口形状）里；
这类判断 SHALL 优先取人的信号。

#### Scenario: 判一条消息是谁说的

- **WHEN** 需要判消息角色
- **THEN** 认「人看的那层」（气泡 / 位置），不认站点换版就撤的设计系统类
  （判据与阈值见 `site-dom` 能力）

#### Scenario: 人是怎么看，就怎么取

- **WHEN** 人忽略的东西（代码块表头、复制下载按钮）出现在 DOM 里
- **THEN** 取正文时也把它排除（见 `site-dom` 的围栏还原）

### Requirement: 人的方式有边界

人的方式慢或有损时（长对话要滚屏拼接、从像素读文字会错、图像这条链收不了）SHALL 退回机器方式
（流式载荷 / 站点接口 / DOM 结构），并在 design 里写清**为什么**。

#### Scenario: 决定退回机器方式

- **WHEN** 选择不采用人的信号
- **THEN** design 里有理由，不是默认放弃

### Requirement: 读渲染的判据要留探测口

「人的信号」常常要读渲染（几何 / 样式）；jsdom 不做布局，所以这类判据 SHALL 留可注入的探测口
（把 `getComputedStyle` / `getBoundingClientRect` 包成替身），真机走真 DOM、单测喂假数据。

#### Scenario: 直接调 `getBoundingClientRect`

- **WHEN** 判据直接调浏览器 API 又想在单测里覆盖
- **THEN** 判不合格——测试会是假的（jsdom 全零）；改成走探测口
