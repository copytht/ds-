# ds-

浏览器扩展与配套本机中继的双栈仓库：

- **扩展**：pnpm + WXT + TypeScript，占仓库根目录
- **中继**：uv + Python，包在根目录的 `dsb/`

## 结构

```
.
├── entrypoints/        # WXT 入口：background、content script
├── src/                # 扩展的纯逻辑层（TS，可单测）
├── dsb/               # 本机 HTTP 中继包（Python）
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

## 中继 dsb（uv）

```bash
uv sync                 # 建 .venv 并按 uv.lock 装依赖
uv run pytest           # 跑测试
uv run ruff check .     # lint
uv run ds-mcp           # 起本机 HTTP 中继（脚本名沿用，名分见 ADR-0001）
```

起之前本机要有 opencode 后台服务在跑，仓库根的 `.env`（不进版本库）写一行会话 id：

```bash
OPENSESS_ID=<opencode 会话 id>
```

端口与口令每次启动时 `opencode service status` / `opencode service get password` **现读**
（口令不落盘、不打印），默认监听 `127.0.0.1:8787`，可用 `.env` 里的 `DSB_PORT` 改。

问一轮分两段等，各有各的预算：先是等目标会话空出来（它在跑活时问题只能在 inbox 里
排队，默认 `DSB_QUEUE_TIMEOUT=600`），见到答复开写之后再给 `DSB_ASK_TIMEOUT=140` 写完。
分开算是因为排队时长看人、不受控，混在一个预算里会把答复的时间吃掉（真机 #14）。

端点：

```bash
curl http://127.0.0.1:8787/health                     # {"status": "ok"}
curl -X POST http://127.0.0.1:8787/ask \
  -H 'content-type: application/json' \
  -d '{"question": "repo 里 dsb 的入口在哪？"}'        # {"status": "ok", "answer": "..."}
```

失败也是同一形状：`{"status": "error", "error": "opencode-not-running" | "opencode-timeout" |
"unexpected-response"}`，扩展据此出**失败提示**（不进对话流）。中继只交结构化结果，
TOON 编码在扩展侧，Python 侧不引任何 TOON 库。

## 约定

- 锁文件（`pnpm-lock.yaml`、`uv.lock`）进版本库；`.venv/`、`node_modules/`、`dist/`、`.wxt/` 不进。
- `src/` 里不用 `console`，输出走返回值（ESLint 会拦）；`entrypoints/` 可以自由打日志，浏览器控制台是那里的调试通道。
- 提交前跑 `pnpm check` 和 `uv run pytest`。
