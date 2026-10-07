## 1. 先验最大的风险（真机，只读 + 一次切换）

- [ ] 1.1 `scripts/env-up.sh --debug` 起 ds-browser；`page-action.py js` 在页面里手工读 `a[href^="/a/chat/s/"]`，确认条目数、`href` 末段、标题 `textContent` 与 design 一致
- [ ] 1.2 验 `el.click()` 点 `<a>` 是 SPA 路由还是整页刷新：切到另一条会话，看 `location.pathname` 是否变、内容脚本回包是否送达（临时探针，不进代码）；**若整页刷新且回包丢，停下，改 design 再继续**
- [ ] 1.3 验侧栏收起时 `a[href^="/a/chat/s/"]` 还在不在 DOM（只读；收起是人手动做，agent 不点）；结果写进 design 的 Open Questions 并据此定 `chats.list` 的空列表口径

## 2. 执行器与闸

- [ ] 2.1 `src/lib/page.ts`：`listChats`（只读，`{ chats: [{ id, title, current }] }`，id 取 href 末段，`current` = href 等于 `location.pathname`）与 `switchChat`（`{id}` xor `{title}`；0 命中 `page-changed`、title 多命中与参数形状错 `unknown-action`、当前会话不点、命中一条就 `click()`，回 `{}`）
- [ ] 2.2 `src/lib/action.ts`：`BACKOFF_GATED_ACTIONS` 加 `chat.switch`（不进 `SPEAK_GATED_ACTIONS`）；`action.test.ts` 补「退避期回 `backing-off`」「speak 闸关着仍放行」
- [ ] 2.3 `entrypoints/content.ts`：`ACTION_ROSTER` 加 `chats.list` / `chat.switch`

## 3. 契约样例与回归用例

- [ ] 3.1 `protocol/fixtures/action.json`：加 `chats.list 成功`、`chat.switch 成功`、`chat.switch 标题重名`（`unknown-action`）、`chat.switch 找不到`（`page-changed`）
- [ ] 3.2 `src/lib/page.test.ts`：用 `evidenceHtml("sidebar.chat-row")` 最小变形造多条 / 重名 / 当前会话，覆盖 spec 的 9 个场景；对拍栅栏不红（无手抄 `path`）
- [ ] 3.3 `pnpm quality` 绿（TS 与 pytest 两半的 `action.json` 对拍都过）

## 4. 真机点验与收尾

- [ ] 4.1 真机 `page-action.py send chats.list`：与侧栏肉眼一致；`send chat.switch --params '{"id": "<另一条>"}'` 后 `page.state` 的 `url` 以该 id 结尾，再切回原会话
- [ ] 4.2 真机验重名：对 5 条同名之一用 `{title}` 切换回 `unknown-action` 且不点；用 `{id}` 能切
- [ ] 4.3 `scripts/page-action.py evidence --id sidebar.chat-row` 仍一致（或「未比」），未被改坏
- [ ] 4.4 `openspec validate --all --archived --strict` 绿；提交、开 PR（`Refs #66`）、CI 绿后合并、删分支
- [ ] 4.5 在 #66 评论：`chat.switch` / `chats.list` 已实现，写明未验证项（如侧栏滚动加载、回包在整页刷新下的行为）
