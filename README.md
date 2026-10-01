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

红过之后原因也留得住：每次翻红都往 `storage.local` 记一条（时刻 / 环节 / 原因），自己绿了
再补上恢复时刻，所以 service worker 被收走、浏览器关掉都丢不了。绿着的时候悬停会回看一句：

```
ds-：总开关已开，中继可达。上次故障 15:23:59（2 分钟前）· 周期探活 · 连接失败，30 秒后恢复。点击切换总开关。
```

当前正红着时不摆历史——第一句就是原因（ADR-0004）。

## 中继 dsb（uv）

```bash
uv sync                 # 建 .venv 并按 uv.lock 装依赖
uv run pytest           # 跑测试
uv run ruff check .     # lint
uv run dsb           # 起本机 HTTP 中继
```

起之前本机要有 opencode 后台服务在跑，仓库根的 `.env`（不进版本库）写一行会话 id：

```bash
OPENSESS_ID=<opencode 会话 id>
```

端口与口令每次启动时 `opencode service status` / `opencode service get password` **现读**
（口令不落盘、不打印），默认监听 `127.0.0.1:8787`，可用 `.env` 里的 `DSB_PORT` 改。

子会话是**可继续**的（后期会被反复调用；决策与取舍见 ADR-0005）：中继只在第一次问时起一个空子会话，之后每问都
往同一个 id 里送，上一轮的问答留给下一轮当上下文——真机验过，第二问能答出第一问说了什么。
于是每问开场要办三件事：**排队**（一个子会话同时只接一轮，后到的问句在锁上等）、**等空闲**
（复用前先等上一轮收干净——忙时 prompt 不是排队而是 steer，新问题会被插进没跑完的那一轮，
实测响应体带 `delivery: "steer"`）、**掐尾巴**（这一轮没答成就把剩下的半个轮次
`POST .../interrupt` 掉，子会话本身留着）。角色框也分两种：首问按「空着出生」讲，续问按
「已经有上文」讲。会话**活期间不删**，收摊才删（Ctrl-C 与 SIGTERM 走同一条路）；复用前先
`GET` 一遍认出「会话没了」（被人删过、或 opencode 换过实例）就当场重起一个。

起子会话前会当场验借来的三样（`agent` / `model` / 工作目录），缺哪样报哪样——早先缺字段是
每问干等 120s 才超时，缺目录更是静默把工作目录写成服务进程的 cwd，两种都毫无信息量。

一轮问句按**静默**计时，不按墙钟：opencode 只要还在动——事件流上还有它这个会话的事件，或
`GET .../message` 上有新消息、正文还在长——这一问就一直等；**静默**超过 `DSB_IDLE_TIMEOUT`
（默认 600s）才判超时。早先是两段墙钟（`DSB_START_TIMEOUT=120` 开工 + `DSB_ANSWER_TIMEOUT=240`
写完 = 360s），模型一进长工具循环就会被硬切：真机跑一轮审阅耗了 268s，写答复那段只剩约 45s。
这里**没有**「整轮墙钟」的硬顶：一次委派能跑多久交给 opencode 自己的闸——`agent.*.steps`
限迭代次数、provider 的 `timeout` 限单次请求（见 ADR-0006 与 `opencode.json`）。中继只管
**静默**：在动就一直等。扩展侧的兜底超时必须宽过这条静默线，否则先到的会是扩展，报出来的就是
「中继不可达」这个
没信息量的码——这条由 `tests/test_relay_server.py` 的跨语言断言守住（它直接读 `dsb/client.py`
的默认值）。

等待的节拍挂在 opencode 自带的事件口 `GET /api/event` 上，而且抢在 prompt 之前挂——晚一步就
吃不到 `execution.started`，轮到「开工」那一步的现场就白瞎了。断流（TCP 一断）与停摆（连续 30s
没有字节）都当场收场，不陪它等满预算；正文判定一步没改，仍以 `GET .../message` 为准，事件
只当信号、不当内容。挂不上事件流不算错，等待退化成老的阻塞 `wait`，只是失去现场与「断流
当场判死」两样。实测中还有个坑值得记着：读不能设超时，`http.client` 的缓冲读超时一次就
永久废掉，第一圈安静之后第二圈就把流判死（详见 ADR-0003）。

端点：

```bash
curl http://127.0.0.1:8787/health                     # {"status": "ok", "opencode": "up"}
curl http://127.0.0.1:8787/status                     # {"status": "ok", "send": null}
curl -X POST http://127.0.0.1:8787/send \
  -H 'content-type: application/json' \
  -d '{"question": "repo 里 dsb 的入口在哪？"}'        # {"status": "ok", "answer": "..."}
```

`/health` 把中继与 opencode 分开报（`opencode: "up" | "down"`）——出事时两者长得一模一样，
分开了才知道该重启哪个。`/status` 是**只读**现场：`send` 为 `null` 表示没有问句在途，否则是
`{"phase": "queued" | "running" | "writing" | "done", "written": <已写字数>, "remaining": <剩余秒数或 null>}`；
它不提供任何指挥能力，`/send` 仍是唯一写入口。

`/send` 还能带一个**轮询 id**（`{"question": ..., "id": "poll-1"}`）：带上它，中继最多让这一趟
挂 15s，没出结果就回 `{"status": "pending", "id": "poll-1"}`，拿同一个 id 接着问即可——**一趟
长问句就这样拆成几趟短 fetch**。扩展必须这么走：MV3 的 service worker 对一条在途 fetch 只保它
约 5 分钟，更长的问句一过线就被浏览器连人带连接一起收走，中继算完了也写不回来（真机日志里两次
`BrokenPipeError`），页面永远等不到回灌、整条链静默停摆。不带 id 就还是老行为：一次问到底
（curl 与测试走这条）。决策与取舍见 ADR-0008。

失败也是同一形状：`{"status": "error", "error": "opencode-not-running" | "opencode-timeout" |
"unexpected-response"}`，扩展据此出**失败提示**（不进对话流）。中继只交结构化结果，
TOON 编码在扩展侧，多行正文走 tabular（SPEC §9.3，一行正文一条 row，换行不产生转义），
Python 侧不引任何 TOON 库、只产 dict。

失败与慢另外留一行带时间戳的日志（`dsb/log.py`，走 stderr；`nohup uv run dsb > /tmp/dsb.log 2>&1`
就收下了）：

```text
[2026-09-30 15:26:58] send-ok took_ms=33118 answer_chars=2
[2026-09-30 15:13:38] bad-request path=/nope http=404 took_ms=0
```

事件名固定：`send-ok` / `send-fail error=…` / `send-broke exc=…` / `spawn-missing missing=…` /
`probe-broke` / `status-broke` / `bad-request` / `slow path=/health took_ms=…`。探活与现场轮询
**超过 1s** 才记 `slow`——它们各有 5s 预算，慢了就是图标翻红的前兆。`spawn-missing` 记缺了父会话
哪样设置（`agent`/`model`/`location`），页面只拿得到 `unexpected-response`，缺哪样得靠它。**问题正文
与答复正文进不来**：字段是具名参数而不是自由 dict，调用点写不出 `question=`；异常只留类型名、不带消息。
访问日志照旧整个关掉（ADR-0004）。

## 约定

- 锁文件（`pnpm-lock.yaml`、`uv.lock`）进版本库；`.venv/`、`node_modules/`、`dist/`、`.wxt/` 不进。
- `src/` 里不用 `console`，输出走返回值（ESLint 会拦）；`entrypoints/` 可以自由打日志，浏览器控制台是那里的调试通道。
- 提交前跑 `pnpm check` 和 `uv run pytest`。
