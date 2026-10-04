# 实施：dsb 内建工作工具

目标：dsb 内建 `ls`/`read`/`grep`/`write`/`edit`，钉死在可配 root 内，无 SHELL，
逻辑解耦成独立模块。范围与契约见 `prd.md` / `design.md`。

## 顺序（勾选）

1. [x] **`dsb/work.py`（新）**——独立模块，先写纯逻辑再包 MCP：
   - 常量：`WORK_ROOT_ENV_KEY="DSB_WORK_ROOT"`、`WORK_READ_LIMIT=16_000`、
     `WORK_LIST_LIMIT=500`、`WORK_GREP_LIMIT=200`、`WORK_LINE_LIMIT=500`、
     `WORK_FILE_LIMIT`；错码常量（`out-of-root`/`bad-path`/`protected-path`/`not-found`/
     `not-a-file`/`not-a-directory`/`edit-no-match`/`edit-not-unique`/`bad-regex`/`io-failed`）。
   - `WorkError(code)`（仿 `GatewayError.code`）。
   - `resolve_work_root(env_text) -> Path`：env → `.env`（`dsb.config.env_value`）→
     `repo_root()`；`expanduser()`。
   - `resolve_in_root(root, raw) -> Path`：沙箱（`resolve()` + parents 判定）。
   - 纯函数：`list_dir` / `read_text` / `grep_tree` / `write_text` / `edit_text`
     （入参 root + 各字段，抛 `WorkError`）。
   - `protected_git(root, resolved) -> bool`：`.git` 判定（读侧不拦、`grep` 跳过）。
   - `work_tools(root) -> list[Tool]`：五件 `Tool`，处理器 catch `WorkError` →
     `({"text": f"{code}（…）"}, True)`；成功 `({"text": …}, False)`。描述带 `[工作目录]`。
2. [x] **`dsb/server.py`**——唯一耦合点：
   - `build_tools(gateway, said, root)` → `[*gateway.tools(), *work_tools(root), *said_tools(said)]`。
   - `main()`：`root = resolve_work_root(env_text)`；`build_tools(gateway, SaidLog(), root)`；
     启动行打印 root。
3. [x] **`tests/test_work.py`（新）**——见 design 的测试策略；用 `tmp_path`。
4. [x] **`tests/test_mcp_server.py`（扩）**——`tools/list` 含五件、无命令执行工具；
   一次 `tools/call` 真读写（`tmp_path` 当 root）。既有用例不受影响（`build_tools` 只有
   `main()` 一处调用）。
5. [x] **`docs/adr/0012-dsb-ships-its-own-work-tools.md`（新）**——决定 + **显式修订
   ADR-0011 的"dsb 不编工具"一条**（保留"被动、无状态、唯一端点"其余部分）。
6. [x] **`CONTEXT.md`**——补词条「工作文件夹」（root）、「工作工具」（五件文件工具）。
7. [x] **`README.md` / `AGENTS.md`**——一句 `DSB_WORK_ROOT` 与五件工具的存在（别复述规范）。
8. [x] **GitHub**——按 issue #6 关闭语**重开该票**，评论里附五问答案（`gh issue reopen 6`）；
   本仓 issue 追踪见 `docs/agents/issue-tracker.md`。

## 验证命令

```sh
pnpm quality                         # eslint+prettier+tsc+ruff+pytest 一起（README 口径）
# 等价细分，排障时用：
uv run pytest tests/test_work.py tests/test_mcp_server.py -q
uv run ruff check dsb tests
```

手动端到端（临时 root，别拿真仓库试写）：

```sh
DSB_WORK_ROOT=$(mktemp -d) uv run dsb &       # 起网关，启动行应打印该 root
# tools/list 应含 ls/read/grep/write/edit（且无命令执行工具）
# tools/call: write 建文件 → read 读回 → ls 看得见 → edit 唯一命中改
# 越界：read {"path":"../x"} → out-of-root
# 护栏：write {"path":".git/config",...} → protected-path
kill %1
```

`scripts/env-up.sh` 起环境后，正常流程（登录/总开关）照旧；本任务不改扩展，
所以判据 1–4 行为不变。

## 风险 / 回滚点

- **`build_tools` 签名变化**：仅 `dsb/server.py:224` 一处调用；`tests/` 无直接调用
  （已核）。改动面受控。
- **工具名裸名**：第三方名恒带 `<server>_` 前缀，不会撞；万一撞，`McpService.register`
  后者胜出（自家说了算）。**注册顺序** `gateway → work → said` 保持 `said_*` 最后。
- **路径沙箱**：`resolve()` 跟随符号链接——务必测符号链接逃逸（`tmp_path` 造）。
- **回滚**：删 `build_tools` 里 `work_tools(root)` 一项即回到现状，无迁移。

## 起手前门禁

- 本文件 + `prd.md` + `design.md` 写完并过用户评审后，才 `task.py start`
  （status: planning → in_progress）。评审前不动产品代码。
- `implement.jsonl` / `check.jsonl` 已配（spec 引用），见同目录两文件。
