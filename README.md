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

工具栏图标即状态位：灰=总开关关，绿=开且中继可达，红=开但中继不可达（悬停给出原因与启动
命令）。开关开着时扩展每 30s 探一次 `GET /health`（`chrome.alarms`，30s 是浏览器对闹钟的
下限），中继中途死掉图标当场翻红，不必等下一次问句失败才暴露；这条只管中继在不在，问句
在途时按住 service worker 的保活是另一回事，两者互不相干。

问句在途时角标还会报现场：`等`（还没开工）/ `想`（在想）/ `写`（在写答复），悬停给完整
一句话（已写多少字、还剩多少预算），答完自动清空。现场来自中继的 `GET /status`，扩展每 3s
轮询一次、每次自带 5s 超时，问不到当场翻红——**进度只走图标，不进对话流**（ADR-0003）。

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

问一轮分两段等，各有各的预算：先是**开工**——spawn 出来的子会话恒为空闲、零消息，
这段等的只是模型多久吐出第一条 assistant（默认 `DSB_START_TIMEOUT=120`）；见到答复开写
之后再给 `DSB_ANSWER_TIMEOUT=240` 写完。分开算是因为前一段不受控，混在一个预算里会把写
答复的时间吃掉（真机 #14）。两段合计 360s；扩展侧的兜底超时 480s 必须宽过它，否则先到的
会是扩展，报出来的就是「中继不可达」这个没信息量的码——这条由 `src/lib/relay.test.ts` 的
跨语言断言守住（它直接读 `dsb/client.py` 的默认值）。

等待的节拍挂在 opencode 自带的事件口 `GET /api/event` 上，而且抢在 prompt 之前挂——晚一步就
吃不到 `execution.started`，「开工」这一段的现场就白瞎了。断流（TCP 一断）与停摆（连续 30s
没有字节）都当场收场，不陪它等满预算；正文判定一步没改，仍以 `GET .../message` 为准，事件
只当信号、不当内容。挂不上事件流不算错，等待退化成老的阻塞 `wait`，只是失去现场与「断流
当场判死」两样。实测中还有个坑值得记着：读不能设超时，`http.client` 的缓冲读超时一次就
永久废掉，第一圈安静之后第二圈就把流判死（详见 ADR-0003）。

端点：

```bash
curl http://127.0.0.1:8787/health                     # {"status": "ok", "opencode": "up"}
curl http://127.0.0.1:8787/status                     # {"status": "ok", "ask": null}
curl -X POST http://127.0.0.1:8787/ask \
  -H 'content-type: application/json' \
  -d '{"question": "repo 里 dsb 的入口在哪？"}'        # {"status": "ok", "answer": "..."}
```

`/health` 把中继与 opencode 分开报（`opencode: "up" | "down"`）——出事时两者长得一模一样，
分开了才知道该重启哪个。`/status` 是**只读**现场：`ask` 为 `null` 表示没有问句在途，否则是
`{"phase": "queued" | "running" | "writing" | "done", "written": <已写字数>, "remaining": <剩余秒数或 null>}`；
它不提供任何指挥能力，`/ask` 仍是唯一写入口。

失败也是同一形状：`{"status": "error", "error": "opencode-not-running" | "opencode-timeout" |
"unexpected-response"}`，扩展据此出**失败提示**（不进对话流）。中继只交结构化结果，
TOON 编码在扩展侧，多行正文走 tabular（SPEC §9.3，一行正文一条 row，换行不产生转义），
Python 侧不引任何 TOON 库、只产 dict。

## 约定

- 锁文件（`pnpm-lock.yaml`、`uv.lock`）进版本库；`.venv/`、`node_modules/`、`dist/`、`.wxt/` 不进。
- `src/` 里不用 `console`，输出走返回值（ESLint 会拦）；`entrypoints/` 可以自由打日志，浏览器控制台是那里的调试通道。
- 提交前跑 `pnpm check` 和 `uv run pytest`。
