# ds-

浏览器扩展与配套本机中继的双栈仓库：

- **扩展**：pnpm + WXT + TypeScript，占仓库根目录
- **中继**：uv + Python，包在根目录的 `dsb/`

## 核心链路（ADR-0011）

网页模型把要调的工具排成一个 ```send 围栏，扩展认出围栏、经本机中继
`POST /mcp`（JSON-RPC 2.0）转给 `mcp.json` 配好的 MCP servers，结果按 TOON 回灌进对话：

````
页面模型 → ```send 围栏(工具调用 JSON) → inject.content(MAIN)
        → 隔离世界 → background → POST /mcp → dsb → mcp.json 里的 servers
        → 结果回灌 → 唯一出站口(ADR-0002) → 页面
````

中继完全被动：不推送、不轮询、无会话、一条 CORS 头都不下发；只有 background 打网络。

dsb 另外内建五件工作工具（`ls` / `read` / `grep` / `write` / `edit`），钉死在工作文件夹
root 内（`DSB_WORK_ROOT` 配置，缺省本仓根），不给任何命令执行；见 `docs/adr/0012`。

## 结构

```
.
├── entrypoints/        # WXT 入口：background、content script、inject(MAIN)
├── src/                # 扩展的纯逻辑层（TS，可单测）
├── dsb/                # 本机中继：MCP 网关（Python）
├── protocol/fixtures/  # TS 与 pytest 共读的线协议对拍
├── docs/adr/           # 架构决策记录
├── tests/              # Python 测试（pytest）
├── wxt.config.ts       # 扩展构建配置
├── package.json        # pnpm 清单
└── pyproject.toml      # uv 清单
```

## 起环境

```sh
scripts/env-up.sh          # 幂等：起缺的、旧代码自动换，末尾打判据
scripts/env-up.sh --status # 只读汇总（含调试口状态）
scripts/env-up.sh --debug  # 让 ds-browser 带 --remote-debugging-port（开发探针用）
pnpm quality               # TS 与 Python 两半一起过
```

## 真机探针（开发用）

外部动作口随 ADR-0011 废掉后，页面动作没有外露探针面。要真机验一件动作：

```sh
scripts/env-up.sh --debug                     # 起/换成带调试口的 ds-browser
uv run scripts/page-action.py read            # 读页面状态（含停止/发送键判定）
uv run scripts/page-action.py send stop.click # 给 DeepSeek 标签页发一件页面动作
uv run scripts/page-action.py stop-test       # 端到端：起生成→等停止键→点→等复位
```

动作走扩展自己的名册（`ACTION_ROSTER`），绕开 `runAction` 的三道闸；只读页面 DOM 与驱动扩展
自身，不 hook 站点、不碰令牌（issue #31 的硬边界）。

## 参考

- [MCP-SuperAssistant](https://github.com/srbhptl39/MCP-SuperAssistant)：把 MCP 带进网页版 AI
