# 扩展层规范（frontend/）

范围：跑在浏览器里的那一半——WXT + TypeScript。目录名沿用 Trellis 模板的 frontend/backend 划分：
**frontend = 扩展层**（`entrypoints/` + `src/`），**backend = dsb 中继**（见 `../backend/`）。

## 指南索引

| 指南 | 何时看 |
| --- | --- |
| [目录结构](./directory-structure.md) | 新增文件、动 entrypoints、拿不准逻辑放哪 |
| [状态与消息](./state-management.md) | 碰 `storage.local`、跨世界消息、background 状态 |
| [类型安全](./type-safety.md) | 解析跨边界载荷、写 parse 函数 |
| [质量](./quality-guidelines.md) | 跑检查、写测试、改协议 fixture、改 UI 文案 |

## 上游文档（本目录不复述）

- 术语：根 `CONTEXT.md`，用它的词，别用它列的 `_Avoid_` 同义词。
- 决策：`docs/adr/`，动手前读碰到的那几篇；与 ADR 冲突要显式提出，不许静默盖过。
- 工作方式：根 `AGENTS.md`；issue / 标签 / 文档流程见 `docs/agents/`。
