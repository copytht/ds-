# 质量与测试

## 跑法

```bash
uv run ruff check .        # 风格：pyproject.toml 的 select
uv run ruff format --check .
uv run pytest              # 全绿为准（别写死项数）；asyncio_mode = auto
```

或者从根目录：`pnpm relay:lint`、`pnpm relay:test`。提交前跑 `pnpm quality`。

## 测试布局

- `tests/test_gateway.py`：`mcp.json` 加载、`resolve_timeout`、`GatewayError`、
  `normalize`、`text_of_result` 等纯函数与子进程编队。
- `tests/test_mcp_server.py`：HTTP 端点与 JSON-RPC 语义（方法、错误码、载荷形状）。
- `tests/test_said.py`、`tests/test_log.py`、`tests/test_config.py`：各自模块。
- `tests/test_work.py`：工作工具的纯逻辑（`work.py`）——路径沙箱（相对/绝对/`..`/符号链接逃逸）、
  五件行为、截断与上限、`.git` 护栏、各错码；用 `tmp_path`，不起中继。
- `tests/test_fixtures.py`：与 TS 共读 `protocol/fixtures/` 的对拍——
  **改了 fixture 必须两半一起改**，见 `../guides/cross-layer-thinking-guide.md`。
- `tests/test_no_direct_site_access.py`：静态守卫，扫 `src/`、`entrypoints/`、
  `dsb/`、`wxt.config.ts`；站点地址只能出现在豁免名单里。

## 已知坑

- **`_guard` 不可重入**：gateway 锁里再抢同一把锁会自锁；加锁路径先想重入。
- 超时与连不上的措辞要分开：`AbortError`（超时）与 `TypeError`（连不上）是两种
  病因，转换处别并成一句。
- `.trellis/` 已在 `pyproject.toml` 的 `ruff extend-exclude` 里（Trellis 自己的
  脚本不进本仓库的检查）；`.opencode/`、`.trellis/` 同理被 eslint 与 prettier
  排除——生成物升级会重生成，同 `vendor/` 口径，见
  `../frontend/quality-guidelines.md`。

## 反模式

- 写需要真实 MCP server 的集成测试——用假子进程/假配置，`conftest.py` 有现成套路。
- 在测试里断言正文内容——留痕口径不记正文（`logging-guidelines.md`）。
