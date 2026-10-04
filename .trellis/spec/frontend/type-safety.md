# 类型安全

## 跨边界的载荷一律过 parse

页面 DOM、`postMessage`、`runtime.sendMessage`、中继响应——四处出来的形状一律当 `unknown`，
经 `channel.ts` / `relay.ts` 的 parse 函数才用：

- **认不出就报认不出，不猜形状。** 围栏里的 JSON 排坏 → `parseToolCall` 不猜它想说什么，
  产出 `okPayload(MALFORMED_CALL_HINT)`；中继响应认不出 → `errorPayload(FAILURE_UNEXPECTED_RESPONSE)`。
- parse 函数一形状一个，命名统一 `parse*`（`parseSendRequest`、`parseToolsList`、`parseAskReport`…），
  构造与解析在 `channel.ts` 成对出现、成对测试。
- 判别用字面量联合（`kind: "call"` / `"result"` / …），解析出的类型跟着判别走，不要 `interface` 大口袋。

## 反模式

- `as any` / `as SomeType` 直通未验证的外部载荷——把「认不出」推迟到运行时更贵的地方炸。
- 调用点就地 `JSON.parse` 绕过 parse 函数 → 第二套（没有护栏的）解析路径。
- 用 optional chaining 掩盖「认不出的形状」：字段缺失要么在 parse 里明确定为缺失，要么整体判认不出。
- 给失败路径编新码：失败码是一本册子（`protocol/fixtures/action.json` ↔ `ACTION_ERROR_*`，
  两失败码 `relay-unreachable` / `unexpected-response` ↔ `src/lib/failurelog.ts`），加码要两头一起加。
