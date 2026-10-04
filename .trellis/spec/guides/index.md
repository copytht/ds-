# 指南索引

跨包、跨层的思考指南——不是某个模块的规矩，而是「做决定前怎么想」。

| 指南 | 解决什么 |
| --- | --- |
| [代码复用](./code-reuse-thinking-guide.md) | 写新逻辑前：仓库里是不是已经有了一件 |
| [跨层思考](./cross-layer-thinking-guide.md) | 改协议 / 失败码 / 消息形状：几个地方要一起动 |

域文档的使用规则不在本目录重复——术语看根 `CONTEXT.md`，决策看 `docs/adr/`，
流程看 `docs/agents/domain.md`。

## Trellis 运维（跑命令前看一眼）

- 非 TTY 环境跑 `trellis init` 会撞到模板选择提示并崩（`ERR_USE_AFTER_CLOSE`）
  → 一律带 `-y` 跳过提示；已有文件要保就再加 `-s`。
- `session_auto_commit: true`（`.trellis/config.yaml`）：`add_session.py` /
  `task.py archive` 会自动以 `chore: record journal` 提交 journal / task 变更
  ——大块工作自己分批提交，别等脚本顺手卷走。
- 生成物（`.trellis/`、`.opencode/`）不进 eslint / prettier / ruff，同
  `vendor/` 口径，升级会重生成——见各层 quality-guidelines。
