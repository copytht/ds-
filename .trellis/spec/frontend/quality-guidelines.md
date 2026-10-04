# 质量与测试

## 一道门跑全

```bash
pnpm quality   # = check（eslint + tsc + vitest + prettier）+ ruff check/format + pytest
```

单块：`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm relay:test`。**提交前 `pnpm quality` 必须绿**；
`pnpm build` 出 `.output/chrome-mv3`。

## 生成物不进检查

`.opencode/` 与 `.trellis/` 是 Trellis 装出来、升级会重生成的别人家代码
（同 `vendor/` 口径）：`eslint.config.js` 的 ignores 与 `.prettierignore`
都排除它们。别把生成物拉进格式化或 lint，也别手改——升级会盖回去。

**已知本地补丁（OpenCode v2 插件）**：`.opencode/plugins/` 下三支插件
（`session-start.js`、`inject-workflow-state.js`、`inject-subagent-context.js`）
与 `.opencode/lib/context-visibility.js` 已就地移植到 OpenCode v2 插件 API
（默认导出 `{id, setup}`；`ctx.session.hook("context")`、
`ctx.tool.hook("execute.before")`；子 agent 工具名 `subagent`、入参 `agent`）。
Trellis 0.6.17 与 0.7.0-beta 仍只发 v1 工厂函数插件，v2 下加载报
`must export a default definition with an id and an effect or setup function`。
这是**有意的手改例外**：`trellis update` 会用 v1 模板盖回，盖回后按同一口径
重新移植（这几个文件在 `.trellis/.template-hashes.json` 里的哈希会失配，属预期）。

## 测试怎么写

- TS：与实现同名共置（`src/lib/relay.test.ts`），vitest；改了 parse 函数就先改它的测试。
- Python：`tests/test_*.py`，`uv run pytest`（`asyncio_mode = auto`）。
- **改线协议 = 三处同步**：`protocol/fixtures/*.json` 是 TS 与 pytest 共读的对拍源，
  `src/lib/fixtures.ts` 与 `tests/test_fixtures.py` 各自读它；只改一half另一half就红。
  细则见 `../guides/cross-layer-thinking-guide.md`。
- 静态守卫 `tests/test_no_direct_site_access.py` 扫 `src/`、`entrypoints/`、`dsb/`、`wxt.config.ts`：
  新文件里出现站点地址会红，豁免名单按该测试自己的注释扩。

## 改文案与改码的纪律

- UI 字符串与标识符里保留的术语（「中继」`FAILURE_RELAY_UNREACHABLE` 等）**换语义不换字面**：
  这些词在 `CONTEXT.md` 的 `_Avoid_` 表里有家人，别顺手改名。
- 改动若与 `docs/adr/` 冲突，先显式提出来（`docs/agents/domain.md`），不许静默盖过。
- 想加失败码 / 消息 kind / 存储键：先找现有册子（fixture、`channel.ts`、`toggle.ts` 导出），
  两头一起加，别开第三本。
