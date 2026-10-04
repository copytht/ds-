# 设计：dsb 内建工作工具（解耦模块）

## 问题

网页模型需要一个能动手改本机文件的工作面，但直接给 SHELL 会突破"钉死 root"的边界。
做法：只给五件受约束的文件工具，全部解析在 root 内，**不给命令执行**。

## 边界与接缝（解耦合）

- 新增自包含模块 **`dsb/work.py`**：root 解析、路径沙箱、五件工具的**纯逻辑**都在这儿。
  **不依赖** `dsb.gateway` / `dsb.server` / 网络；只 import 标准库 + `dsb.mcp.Tool`
  （注册形状这一处薄接缝）+ `dsb.log.log_event`（留痕）。
- 五件工具的**逻辑**写成对 `root: Path` 的纯函数，与 MCP 信封解耦：
  `resolve_in_root` / `read_text` / `write_text` / `edit_text` / `list_dir` / `grep_tree`。
- MCP 适配层只有 `work_tools(root) -> list[Tool]`：把每个纯函数包成
  `arguments -> ({"text": …}, failed)` 的处理器。
- **dsb 只在 `dsb/server.py` 的 `build_tools` 挂一行**——这是唯一的耦合点。
  将来要换实现或挪成独立进程，只动这一行。

```
main() ──resolve_work_root(env)──▶ Path
          │
build_tools(gateway, said, root)
   ├─ gateway.tools()        # 第三方（<server>_<tool>）
   ├─ work_tools(root)       # ★ 本项目：五件，裸名
   └─ said_tools(said)       # 自家记话（不进目录）
          │
McpService.register(...)  # 同名覆盖：后注册的说了算 → 自家工具在撞名时胜出
```

## 五件工具的契约

名字用**裸名**（与 issue #4 的围栏语言一致）。第三方工具名恒带 `<server>_` 前缀，
不会与裸名相撞；万一相撞，`McpService.register` 后者胜出（自家说了算）。
描述带 `[工作目录]` 出处，与网关的 `[server]` 同款。

| 工具 | 入参 schema | 成功 | 失败码（见下） |
| --- | --- | --- | --- |
| `ls` | `{path?: string}` 默认 `.` | 直接子项，目录带尾 `/`，按名排序 | `out-of-root`,`not-found`,`not-a-directory` |
| `read` | `{path: string}` | 文件正文（超限截断+标注） | `out-of-root`,`not-found`,`not-a-file` |
| `grep` | `{pattern: string, path?: string}` 默认 `.` | `相对路径:行号: 行` | `out-of-root`,`not-found`,`bad-regex` |
| `write` | `{path: string, content: string}` | 建/覆盖（自动建父目录），回字节数 | `out-of-root`,`protected-path`,`not-a-file` |
| `edit` | `{path: string, old_string: string, new_string: string}` | 唯一命中才替换，回替换数 | `out-of-root`,`protected-path`,`not-found`,`not-a-file`,`edit-no-match`,`edit-not-unique` |

返回口径与网关工具一致：成功/失败都是 `{"text": "<给模型看的正文>"}` + `failed` 布尔
（`McpService.text_result` 包成 content/isError）。**错码是正文的一部分**，形如
`out-of-root（路径 …）`，模型读得到、接得下去——与 `tool-not-running（工具 …）` 同款。

### 错码册子（`dsb/work.py` 常量）

`out-of-root` / `bad-path` / `protected-path` / `not-found` / `not-a-file` /
`not-a-directory` / `edit-no-match` / `edit-not-unique` / `bad-regex` / `io-failed`。

（这是**工具载荷码**，与 `dsb/gateway.py` 的三码、`dsb/mcp.py` 的 JSON-RPC 码分属三套，
不混。与 AGENTS.md 里页面动作的 `composer-absent` 等更是两码事。）

## root 解析与路径沙箱

```python
def resolve_in_root(root: Path, raw: str) -> Path:
    if not isinstance(raw, str) or not raw.strip():
        raise WorkError("bad-path")
    candidate = Path(raw)
    if not candidate.is_absolute():
        candidate = root / candidate
    resolved = candidate.resolve()            # 跟随符号链接
    root_real = root.resolve()
    if resolved != root_real and root_real not in resolved.parents:
        raise WorkError("out-of-root")
    return resolved
```

- `resolve()` 跟随符号链接、并规范化 `..`——**符号链接逃逸与 `..` 一起挡住**。
- 绝对路径也接受，但同样必须落在 root 内。
- 不存在的路径：`resolve(strict=False)` 解析已存在的祖先再拼尾巴，仍能判越界；是否"存在"
  交给各工具自己判（`not-found`）。
- root 自身不存在：`resolve_work_root` 时就报，`main()` 打印一行并**照常起服务**
  （工具调用时才回错，别让整个网关起不来）。*（待定：见下方取舍。）*

## `.git` 护栏

`write`/`edit` 在解析后，若路径**在 `<root>/.git` 之下**（含 `.git` 本身；worktree 里
`.git` 是文件也算），回 `protected-path`，不动文件。读侧（`ls`/`read`/`grep`）不拦。
`grep` 遍历时**跳过 `.git/`**（体积/二进制噪音），与护栏同一处常量。

## 截断与上限（保护对话与前程）

- `WORK_READ_LIMIT = 16_000` 字符（沿用 issue #4）。`read` 超限截断并追加
  `…（已截断，超出 N 字符）`。
- `ls` 上限 `WORK_LIST_LIMIT = 500` 条；`grep` 上限 `WORK_GREP_LIMIT = 200` 条命中，
  单行超 `WORK_LINE_LIMIT = 500` 字符截断。
- `grep` 跳过二进制文件（首块含 `\x00` 判定）与超 `WORK_FILE_LIMIT` 的文件。

## 扩展侧：零改动（为什么）

`entrypoints/background.ts` 的 `serveTools()` 只过滤 `said_` 前缀，其余工具原样进协议说明；
目录行由 `src/lib/relay.ts` 的 `parseToolsList` 生成，描述取自工具自身。所以 dsb 新增的
工具**自动出现**在模型目录里，**TS 侧一行不改**，`instructions.test.ts` 的黄金值不动。

## 配置

- `.env` / 环境变量 **`DSB_WORK_ROOT`**：工作文件夹根，缺省 = `dsb.config.repo_root()`。
- 解析仿 `resolve_port`/`resolve_timeout`：进程环境变量优先，其次 `.env`，最后默认；
  路径 `expanduser()`；非目录 → 报一行、按默认处理或拒绝（见取舍）。

## ADR 与术语

- **新开 `docs/adr/0012-dsb-ships-its-own-work-tools.md`**：记"dsb 内建工作工具"这一决定，
  并**显式修订 ADR-0011 的"dsb 不编工具"一条**（保留其"被动、无状态、唯一端点"其余部分）。
- **`CONTEXT.md` 补词条**：*工作文件夹*（root）、*工作工具*（五件文件工具）。术语用中文，
  避开 `_Avoid_` 同义词。
- 依 issue #6 关闭语，**重开该票**并在评论里附本次五问的答案（GitHub 动作，非代码）。

## 取舍（Considered Options）

- **独立 stdio MCP server（B）**：用户选了内建（A）；"解耦"由独立模块满足，不必多一个进程。
- **直接配现成 server（Desktop Commander 等，C）**：用户否决——要自家钉死 root 的版本。
- **给 SHELL + `sandbox-exec` 真沙箱**：重度、绑死 macOS，issue #6 当年正为此 `needs-info`；否。
- **不截断**：`read` 一个万行文件就撑爆对话与 token 预算；否。
- **root 不存在时拒绝起服务**：会让"没配就整个网关起不来"；选择**照常起、调用时才报**
  ——与"没配 MCP server 只打印一行"同一口径。

## 测试策略

- `tests/test_work.py`（新，纯函数为主）：
  - `resolve_in_root`：相对 / 绝对 / `..` / 符号链接逃逸（`tmp_path` 造链接）/ root 自身；
  - 五件行为：`ls` 排序与尾斜杠、`read` 截断标注、`write` 建父目录、`edit` 唯一性
    （0/1/多）、`grep` 命中格式与上限；
  - `.git` 护栏：写 `.git/config` 回 `protected-path` 且文件不变；
  - 各错码各一例。
- `tests/test_mcp_server.py`（扩）：`tools/list` 含五件且无命令执行工具；一次 `tools/call`
  真读写（`tmp_path` 当 root）。
- 静态守卫照旧；`protocol/fixtures` 不动（消息信封未变）。

## 兼容与回滚

- **兼容**：纯增量。第三方工具命名规则与目录形状不变；协议说明的 TS 黄金值不变。
- **回滚**：删掉 `build_tools` 里 `work_tools(root)` 那一项即回到"只有 said_*"，
  无数据迁移、无外部状态。
