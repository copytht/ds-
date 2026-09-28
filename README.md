# ds-

浏览器扩展与配套 MCP 服务的双栈仓库：

- **扩展**：pnpm + WXT + TypeScript，占仓库根目录
- **MCP 服务**：uv + Python，包在根目录的 `dsb/`

## 结构

```
.
├── entrypoints/        # WXT 入口：background、content script
├── src/                # 扩展的纯逻辑层（TS，可单测）
├── dsb/               # MCP 服务包（Python）
├── tests/              # Python 测试（pytest）
├── wxt.config.ts       # 扩展构建配置
├── package.json        # pnpm 清单
└── pyproject.toml      # uv 清单
```

`src/` 只放 TypeScript，`dsb/` 只放 Python，两边互不交叉。

## 一条命令全检

```bash
pnpm quality            # TS：lint + typecheck + test + format：再接 Python 的 ruff + pytest
```

## 扩展（pnpm）

```bash
pnpm install            # 装依赖
pnpm dev                # 开发模式（WXT dev server + 热更新）
pnpm build              # 产物在 .output/
pnpm test               # vitest
pnpm lint               # eslint
pnpm typecheck          # wxt prepare && tsc --noEmit
pnpm format             # prettier
pnpm check              # 上面四项串起来，提交前跑这个
```

## MCP 服务（uv）

```bash
uv sync                 # 建 .venv 并按 uv.lock 装依赖
uv run pytest           # 跑测试
uv run ruff check .     # lint
uv run ds-mcp           # 起 MCP 服务（stdio）
```

注册到 MCP 客户端（如 Claude Desktop / OpenCode）的命令：

```bash
uv --directory /绝对路径/ds- run ds-mcp
```

新工具写在 `dsb/server.py`，用 `@mcp.tool()` 装饰即可。

## 约定

- 锁文件（`pnpm-lock.yaml`、`uv.lock`）进版本库；`.venv/`、`node_modules/`、`dist/`、`.wxt/` 不进。
- `src/` 里不用 `console`，输出走返回值（ESLint 会拦）；`entrypoints/` 可以自由打日志，浏览器控制台是那里的调试通道。
- 提交前跑 `pnpm check` 和 `uv run pytest`。
