# agent 侧也能指挥页面：dsb 多一条动作流，扩展多一个外部指挥面

扩展一直是「页面 → dsb → opencode」的上一半；反过来，agent 侧从来没有指挥页面的口子。结果是
每次要操作页面（发一条消息、读对话、盯回灌）都得临时写一份 CDP 脚本直接操 DOM。决定给 dsb 加
一条**动作流**（SSE），扩展订阅它、在页面里执行**页面动作**，agent 调 dsb 就能指挥页面。这是
「对等互通」缺的另一半。

## Considered Options

- **外挂 CDP**（直连浏览器调试端口操 DOM）：不改扩展、当天能做。但它绕开扩展已经吃透的那套
  ——写入走**站点自己的发送路径**、围栏识别靠**截站点网络响应**——改成又一份脆的 DOM 选择器，
  还要求浏览器带 `--remote-debugging-port` 起。弃。
- **扩展轮询**：MV3 的 `chrome.alarms` 最快 30s，固定短轮询得靠 service worker 里自排
  `setTimeout`；而 service worker 空闲约 30s 就被浏览器收走——快轮询这条命活不长。SSE 是「一条
  挂着的连接 + 中继定期心跳（~15s）」，天然把 service worker 按住又即时。选 **SSE**。
- **异步 id + 轮询**（提交拿 id，agent 自己再去取结果）：`wait.reply` 这种天然慢的动作也得轮询，调用
  方还要自己拼「取结果」，徒增来回。改成**阻塞式串行队列**：动作按标签页进队列、串行执行，提交方**阻塞**
  到它做完、直接拿结果——队列解决「动作不打架」，阻塞解决「一次调用一个结果」。
- **读端点也要 token**：扩展读不了本地文件，token 给不到它。改成分头认——**写**端点（agent 发
  动作）验 token（dsb 启动时生成、落在本机、调用时自动交给 agent）；**读**端点不验 token，靠
  「不下发 CORS 头 + 只认扩展来源」让网页的跨源请求撞死，本机进程与扩展天然放行。弃「扩展也持
  token」。

## Consequences

- **dsb 成了双向总线**：原来只把扩展的问题转给 opencode，现在还要把 agent 的动作推回扩展。
  中继「只读 `/status` + 唯一写入口 `/ask`」这条边界不再成立——这是这一版最难逆的一处，也是
  为什么值得单独一条 ADR。
- **扩展多了第一个外部指挥面**：安全由三条一起兜——token 拦本机乱发的进程、CORS 拦网页、动作
  只在**总开关开着且订阅了动作流**时执行。用户没开，通道不活着（和「站点范围钉死」同一条思路）。
- **动作挑在页面里执行**：写输入框走 React 的原生 value setter + `input` 事件；发送点
  `div[role=button].ds-button--primary.ds-button--filled.ds-button--circle`（禁用看 class
  `ds-button--disabled`，不是属性）；选择器一律优先 `ds-*` 设计系统 class 与语义属性，不碰会随
  部署变的哈希 class。
- **顺带修一个现有 bug**：`inject.content.ts` 的 `findSendButton` 用 `button[aria-label*=send]`
  这类选择器，真页面上一个都匹配不到（发送键是 `div[role=button]`、没有 aria-label，输入框也没有
  form 祖先），一直返回 null——现在发送实际只靠回车，click 兜底是死代码。这条通道要的正是可靠的
  `send.click`，一并修掉。
- **已知缺口**：`stop.click`（停止生成）的选择器还没在「生成中」确认过；消息列表是虚拟列表，只有
  视口里的行在 DOM。
- **最小单元**：读 `tabs.list` / `page.state` / `composer.read` / `messages.list` /
  `messages.last`；写 `composer.type` / `composer.clear` / `send.click` / `send.enter` /
  `stop.click` / `chat.new`；等 `wait.reply` / `wait.fence`；开 `toggle.get` / `toggle.set`。
  第一个组合功能是 `send.page`（往页面发一个问题 → 等页面模型排围栏 → 等回灌 → 取答复）。
- **`send` 不叫 `ask`**：页→agent 那个方向已经占了 `/ask`，agent→页这个方向用 `send` 命名，别混。
- **接口保持 agent 中立**：页面动作与 agent 无关；每个 agent（含**将来自己实现它那一侧**的 subagent）
  自带一个**薄兼容层**，别把某个 agent 的调用习惯砌进 dsb。
