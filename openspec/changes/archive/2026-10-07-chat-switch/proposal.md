## Why

`chat.switch`（切换会话）从 #30 起就挂在「已核实定位、待实现」的位置，openspec 与 `adr/` 里都没有
它的记录——只在 #30 正文出现过一句「本期不实现」。插件要能自主换会话，agent 就得能切换上下文，
这是硬需求，不是可选控件。

同时它是 #66 那 11 项候补的同类：单看定位是清楚的，但 ADR-0018 要求登记最小单元时原样保留
按钮的代码与图片、由测试检查符合原样。仓里目前**没有任何一条会话条目存证**。

## What Changes

- `frontend` spec 的「页面动作的候补控件只登记、不进名册」MODIFIED 一轮：把 `chat.switch` 登记进候补，
  写清真机实测的定位口径（`a[href^="/a/chat/s/"]`、`href` 末段即会话 id、标题取条目内文本）、
  形状陷阱（条目内嵌一颗 hover 才显形的「更多」按钮，与消息工具栏那批同形）、返回形状。
- **补存证**（ADR-0018）：`sidebar.chat-row` 一条（`state-bound`——条目内那颗 hover 按钮让它不是常驻态），
  随取随对拍。
- 记下「参数按标题还是按会话 id」的取舍：标题可读但会重名（当前侧栏有 5 条同名「列出工作目录文件」），
  id 唯一但不好从人话里推。
- **不做**：`chat.switch` 的执行器与进 `ACTION_ROSTER`。切换是写动作且会改页面状态，
  要过「写动作登记闸门」（`BACKOFF_GATED_ACTIONS`）与退避，实现留待另一个 change。

## Capabilities

### New Capabilities

- (none)

### Modified Capabilities

- `frontend`: 候补表新增 `chat.switch`，写清真机定位口径、形状陷阱与参数取舍

## Impact

- `openspec/specs/frontend/spec.md` 的候补 requirement（经归档同步）
- `protocol/evidence/controls.json` 新增 `sidebar.chat-row`
- 不改 `ACTION_ROSTER`、不改执行器、不改 `protocol/fixtures/action.json`、不改 `site-dom` 锚点
- 需要 ds-browser（独立 profile）已登录，才能抓存证
