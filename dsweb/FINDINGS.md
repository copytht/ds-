# FINDINGS — DeepSeek 网页端逆向结论

抓取：`uv run scripts/fetch-dsweb-bundle.py`（bundle 名带 hash，发版即变，
本文引用的位置以 `main.<hash>.js` 为准，位置号会随发版漂移）。

---

## 1. 前端文本输入闸：`input_character_limit = 2,621,440` 字符

**来源**：`cu()` 在服务端的 `model_configs` 里按当前模型取配置，`cf()` 取其
`input_character_limit`：

```js
cf = () => {
  let e = cu();
  if (e) return e.input_character_limit;
};
cu = () => {
  let e = bk();
  return cc().find((t) => t.model_type === e);
};
```

`cc()` 读特性缓存 store 的 `model_configs`，该 store 落在
`localStorage.__ds_remote_feature_store_model`，**服务端下发**。

实测三个模型（快速 / 专家 / 识图）**同值 `2621440`**（= 2.5 × 2²⁰）。

### 显示公式与条件

前端 `vB` 钩子（位置 ~605714）：

```js
s = cf()                                       // 上限
i = s !== undefined && value.length > s        // 超限？
l = Math.round((value.length - s) / value.length * 100) + "%"   // 百分比
charCounterNode = n && l ? <「超长约 {l}」> : null
```

- **百分比 = (输入长度 − 上限) / 输入长度 × 100**，即「超过上限的部分占
  整条的百分比」。
- **只有提交 / 粘贴触发拦截后才显示**：`n` 初值 false，由
  `interceptSubmit`（提交）或 `notifyPasteOverLimit`（粘贴）置真——
  所以「只填不发」时页面**看不到**百分比，这是真机复现不出它的原因。
- 超限时提交被拦（`couldSubmit: !g && !!x && (!v || (y ? !l : C))`，
  位置 ~631519，`y` = `interceptSubmit`），并弹 toast
  「内容超长约 X%，请删减后再试」。

用截图与实测全部精确吻合（1570 万字 → 83%、304 万 → 14%、609 万 → 57%、
914 万 → 71%、1218 万 → 78%）。

---

## 2. 关键：前端**没有任何分词器**

grep `tokenizer` / `Tokenizer` / `BPE` / `encode_text` / `count_tokens` /
`tokens_count` / `estimate_token` —— **全部零命中**。

**含义**：前端**不具备**把字符数换算成 token 的能力。因此
`input_character_limit = 2,621,440` **不可能**是从任何 token 预算推出来的
——它是一个纯字符数。这也是它与后端 token 上限**天然不对齐**的根因。

---

## 3. 配置里出现 token 的三个数（都不是文本输入闸）

| 键                                    | 值      | 作用域           |
| ------------------------------------- | ------- | ---------------- |
| `file_feature.token_limit`            | 890,880 | 文件上传         |
| `normal_history_and_file_token_limit` | 890,880 | 历史 + 文件      |
| `r1_history_and_file_token_limit`     | 890,880 | R1 的历史 + 文件 |

源码取用（位置 ~397714）：

```js
co = ({ thinking, modelType }) => {
  let s = file_feature;
  if (!s) return 61440; // 缺配置时兜底 61440
  return thinking ? s.token_limit_with_thinking : s.token_limit;
};
```

**文本输入那条路上一个 token 字段都没有**——只有字符闸。

---

## 4. 请求体（实测抓包，`/api/v0/chat/completion`）

```json
{
  "chat_session_id": "...",
  "parent_message_id": null,
  "model_type": "default",
  "prompt": "<用户正文>",
  "ref_file_ids": [],
  "thinking_enabled": false,
  "search_enabled": true,
  "action": null,
  "preempt": false
}
```

- **没有系统提示词字段**——客户端只发用户 `prompt`，系统提示词是**服务端
  加的**（所以客户端侧数不出「系统提示词占多少 token」）。
- 站点走 **XHR** 收 SSE（`fetch` / `EventSource` 抓不到），这点对写探针很关键。

---

## 5. PoW（工作量证明）

发 completion 前先要过一次 PoW：

```
POST /api/v0/chat/create_pow_challenge
→ { salt, signature, difficulty: 144000, expire_after: 300000,
    target_path: "/api/v0/chat/completion" }
```

`difficulty` 量级不小，且 `expire_after` 只有 5 分钟——探针批量跑时容易撞上
过期失败。

---

## 6. 服务端会回报 token 用量（可用来校准分词器）

```js
nn = (e) =>
  e.status === MessageStatus.CONTEXT_LENGTH_EXCEEDED ? 1 / 0 : e.accumulated_token_usage || 0;
```

每条消息带 `accumulated_token_usage`，另有显式状态
`CONTEXT_LENGTH_EXCEEDED`。**这是校准分词器的钩子**：发一条已知文本，拿服务端
自报的 token 数跟自己用的分词器对账，就知道分词器选对没有。

---

## 7. 已知 API 端点（逆向用）

```
/api/v0/chat/completion            /api/v0/chat/continue
/api/v0/chat/regenerate            /api/v0/chat/edit_message
/api/v0/chat/resume_stream         /api/v0/chat/stop_stream
/api/v0/chat/history_messages      /api/v0/chat/create_pow_challenge
/api/v0/chat_session/create        /api/v0/chat_session/fetch_page
/api/v0/chat/tts/…
```

超时（特性缓存 `__ds_remote_feature_store`）：`completion_request_timeout_ms = 60000`、
`sse_auto_resume_timeout = 3000`。

---

## 8. 未摸清（不要当成已知）

- **站点实际用哪个模型 / 分词器，没验证过。** 本仓 ADR-0028 的「~98 万
  token」是**用 `deepseek-ai/DeepSeek-V3` 分词器**数的，而配置里
  `normal_history_and_file_token_limit = 890,880` 与实测的 ~98 万**对不上**。
  可能原因：站点用的是别的分词器（则 ADR-0028 的数字要按它重算）、或
  890,880 另有所指、或上下文预算含了别的开销。**没查清前，ADR-0028 的
  token 口径只在「DeepSeek-V3 分词器」这个前提下成立。**
  校准办法见 §6（用 `accumulated_token_usage` 对账；本轮被 PoW 打断，
  未做完）。
- **前端 2,621,440 是按什么拍的**，未知。它显然是「2.5 MB」量级的整数，
  但没有证据说明它对应哪种文本密度或哪次发版决策。
- **891,880 / 890,880 与实测 ~98 万的关系**没搞清（见上）。
- `normal_history_and_file_token_limit` 是否也作用于**纯文本**对话，未验——
  代码里文本那条路没引用它。
