# Spec Delta

## MODIFIED Requirements

### Requirement: 改协议要按清单同步动

改任何线协议（围栏内容、chain 消息 kind、runtime 消息类型、失败码、工具目录）时 SHALL 逐项同步：
`protocol/fixtures/*.json`、扩展侧构造 / 解析与类型（成对加）与 `*.test.ts`、中继侧对应语义与
`tests/test_*.py`、以及 `CONTEXT.md` 词条 / `adr/` / 本 spec 相关篇。

#### Scenario: 少改一处

- **WHEN** 只有一边改了
- **THEN** `pnpm quality` 里的 fixture 对拍变红（设计如此，不是麻烦）

#### Scenario: 先加字段后补语义

- **WHEN** 在 fixture 里加「以后再用」的字段
- **THEN** 判不合格（对拍会要求两边立刻有语义）
