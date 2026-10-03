# Design: 全能力规格归档

## Approach

- 先同步 `backoff-after-mute` 已完成的 `outbound-backoff`
- 再按 `src/lib/` 模块边界写其余核心规格（gate/watchdog/fence/action/message/channel/toggle）
- 不改实现；规格由源码与现有测试确定

## Constraints

- `CONTEXT.md` 词汇表优先：新名词先查根，再写规格
- 不可逆决定先落 ADR（已在 `docs/adr/0001-0010`），规格引用 ADR 而非重写
- 三处册子同步（ADR-0010）：`protocol/fixtures/action.json` / `dsb/actions.py` / `tests/test_actions.py`
