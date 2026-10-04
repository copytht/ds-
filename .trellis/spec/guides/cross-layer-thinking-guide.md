# 跨层思考：一处改，三处看

协议是扩展与 dsb 的契约，改一处必须同步动另一处——本仓库用
**fixture 对拍**把这件事变成红灯，而不是靠记忆。

## 协议改动清单

改任何线协议（围栏内容、chain 消息 kind、runtime 消息类型、
失败码、工具目录）时，逐项打勾：

1. **`protocol/fixtures/*.json`**——TS 与 pytest 共读的源。
   `fence.json`（围栏）、`action.json`（动作码）、`reply.json`
   （回灌与失败码）、`config.json`（配置键）。
2. **扩展侧**：`src/lib/` 的构造/解析函数与类型（成对加），
   对应 `*.test.ts`。
3. **中继侧**：`dsb/mcp.py` / `gateway.py` 的对应语义，
   `tests/test_*.py`；`src/lib/fixtures.ts` 与 `tests/test_fixtures.py`
   会自动把 fixture 的新旧两边拉齐。
4. **文档**：`CONTEXT.md` 词条、`docs/adr/` 新决策或补记、
   本 spec 里点到的那几篇。

少一步，`pnpm quality` 里的 fixture 对拍就会红——这是设计好的，
不是麻烦。

## 方向性纪律

- **只有 background 打网络**（`src/lib/relay.ts`）：MAIN 与隔离
  世界不 fetch，规避 CORS；dsb 一条 CORS 头都不下发。
- **dsb 完全被动**：不推送、不轮询、无会话（ADR-0011）。
  扩展侧需要现场时，由扩展周期探活（`ping`）或按需 `tools/list`
  （缓存 60s，坏数据沿用旧表）。
- **失败提示不进对话流**：只有「有回话」才回灌；连不上才落
  扩展侧失败提示（ADR-0010）。

## 反模式

- 「先在扩展侧加个字段，dsb 下周跟上」——fixture 对拍当周就红，
  没有中间态。
- 在 fixture 里加「以后再用」的字段——对拍会要求两边立刻有语义。
- 改协议不改 `CONTEXT.md` 词条——下一个会话的 agent 会按旧词想事。
