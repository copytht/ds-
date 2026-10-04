# 站点代码里的角色（2026-10-04，`capture --codes` 抓的）

`uv run scripts/page-action.py capture --codes` 落 `captures/<时间戳>/codes/`（8 个脚本，
主包 `01-main.*.js` 1.5MB）。grep 出来：

## 1. 消息模型自带角色

```js
…chat_message_id:n, parent_message_id:null!=s?s:0, chat_message_role:"user",  full_chat_message_id:…
…chat_message_id:r, parent_message_id:i,     chat_message_role:"assistant", full_chat_message_id:…
```

**`chat_message_role` 是数据字段**（`"user"` / `"assistant"`），在站点自己的请求/响应载荷里。
这比任何 DOM 启发式都准，而且与标记换版无关。

> 我们**已经在**截站点的请求 / 响应体了（`entrypoints/inject.content.ts` 包 `fetch`/`XHR`：
> 一是注入协议说明，二是喂围栏检测）。也就是说这条载荷路是**现成的**，不用新开 hook。

## 2. 两套标记是同一份代码的两个分支

`main.*.js` 里 `.ds-assistant-message-main-content` 与 `_81e7b5e` **都出现**（各 1 次）——
说明「经典 / 新式」是同一份包里的两条渲染分支（A/B / 按会话开关），不是两次发版。
所以我们**两套都得认**，不能赌哪一套。

## 3. 没找到的东西（据此排除）

- 气泡底色 `237, 243, 254` 在 JS 里**没有** → 颜色在 CSS 里（`styles.css` 只抓到 1.9KB，
  样式多半在跨源表 / CSS-in-JS 注入，没抓全）→ 再印证「别拿颜色当判据」。

## 结论（影响设计）

- **首选源是载荷里的 `chat_message_role`**（
  真实、与 DOM 无关、且我们已经握着这条管子）；
- DOM 渲染层（气泡）退成**兜底**（载荷里没有的、或非亲历的历史）；
- 之前「用渲染层判角色」的规划**要改**——有更硬的源就不该用启发式。
