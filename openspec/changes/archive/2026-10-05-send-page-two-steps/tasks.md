# Tasks

## 1. 实现（含测试）

- [x] 1.1 `src/lib/localtools.ts`：`sendPageSteps` 只留 `composer.type` → `send.enter` 两步；
      删 `replyTextOf`；`run` 里 `parseReplyPayload` 那段删掉，两步走完回 `okPayload("")`。
      顶部文件注释里那句「往页面发一个问题 → 等页面模型排围栏 → 等回灌 → 返回答复正文」
      同步改成两步的口径。验证：`grep -n "wait.reply\|parseReplyPayload" src/lib/localtools.ts` 零命中。
- [x] 1.2 `seconds` 参数处置：`question` 成唯一入参（`params: ["question"]`），从
      `LocalTool.params` 与函数签名里去掉 `seconds` 归一——留着会让模型以为要等。
      `normalizeSeconds` 若别处无引用就一并删，有引用就留着（只在注释里说明它服务 `wait.*`）。
      验证：`grep -rn "normalizeSeconds" src/` 的结果与决定一致；`params` 不再列 `seconds`。
- [x] 1.3 `src/lib/localtools.test.ts`：四步顺序那条改成两步；删三条 `wait.reply` 相关的用例
      （`wait.reply` 回正常回灌 / 解不出回 `page-changed` / 结果里没有 text）；
      `question` 校验与「任一步没成即停」两条保留并改断言（第二步失败时只调两步）。
      验证：`npx vitest run src/lib/localtools.test.ts` 全绿，且**没有一条用例还在造
      `wait.reply` 的回灌文本**（那是在测已删掉的半边）。
- [x] 1.4 `src/lib/instructions.ts`：本地工具那段描述改成「往页面发一个问题」口径
      （去掉「等回灌、返回答复正文」）；`:51` 的失败处置口径补上工具自己回的码。
      验证：`src/lib/instructions.test.ts` 的对拍用例同步改后全绿（它现在硬编码了整段文案）。

## 2. 文档与票

- [x] 2.1 `docs/adr/0013-local-tools-run-in-the-extension.md` 加一条补记：`send.page` 从四步
      缩到两步（ADR-0014 之后自指），以及 **issue #23 的原始需求仍未满足**（本 ADR 改住
      扩展侧后只对围栏里的页面模型生效，agent 仍调不到页面动作——见本 ADR `:23-24`）。
      验证：补记里能读到「本 ADR 的机制与论证保留，`send.page` 只是缩了步数」。
- [x] 2.2 `protocol/fixtures/action.json`：`wait.reply 成功` 样例**留着**（`wait.reply` 仍是
      页面动作，只是不再被 `send.page` 用），确认没有别的样例替它撒谎。验证：
      `grep -n "send.page" protocol/fixtures/action.json` 零命中（本地工具不进 fixture，
      它不是页面动作）；`pnpm quality` 绿。
- [x] 2.3 #47 票补一条：严重度表述修正（「模型合理地重试」→「**行为未定义**」，因为
      `instructions.ts:51` 的「别重排」口径没覆盖 `page-changed`）+ 补第四处证据
      （`instructions.ts:50` 那个假承诺）。验证：票里能读到修正后的表述。

## 3. 门

- [x] 3.1 `pnpm quality` 全绿。验证：退出码 0。**实测 491 vitest + 143 pytest**（原 496，
      净 −5：删 3 条 `wait.reply` 用例 + 2 条 `normalizeSeconds`，加 3 条两步用例）。
      门还抓出两处：①`ACTION_ERROR_PAGE_CHANGED` 随之unused（eslint 红）——已删该 import；
      ②上一个 change 归档的 `archive/2026-10-05-continuation-spec/tasks.md` 没格式化
      （prettier 红，与本 change 无关）——已格式化。
- [x] 3.2 `openspec validate "send-page-two-steps" --strict` 与 `--all --strict` 过
      （7 passed / 0 failed）。
- [x] 3.3 真机（限速、`chat.deepseek.com` 前台）：**触发方式**——`page-action.py js` 在页面
      里 `postMessage` 一条 `ds-/chain` / `kind:"call"` 信封（`send.page` 不在 `ACTION_ROSTER`
      里，但 `content.ts:186` 认这条链 → `forwardToRelay` → background → `findLocalTool`）。
      ①**回成功确认**（不再是 `page-changed`）：✅ 硬证据——短标记出现了，而
      `isInjectableReply`（`reply.ts:119-121`）只放行 `status: "ok"`，`page-changed` 会让
      `sendCalls:570` 整轮作废、不会有标记；②问题真发出去：✅（页面出现那条文本）；
      ③回答照旧被 `detect()` 看见：✅ 间接——那条标记本身就是 `handleResult` 排进队列的产物；
      ④模型没重排：✅ 间接——**只有一条** `agent: 继续` 标记，重排会再排一条。
      控制台无「续聊没有发出去」类报错。
      **⚠️ 两个查不下去的发现（已开 #54）**：该会话上 `messages.list` 稳定回 `page-changed`
      （页面上有两个 `.ds-virtual-list`，`conversation()` 挑错列表——我没碰 `messages.ts`，
      不是本 change 引起的），所以③ 只能停在间接证据、无角色+正文交叉验证；三行里两行文本
      相同（`len` 均 1479），「是页面渲染两次还是真发两次」**判定不出**（刷新后仍两条，两种
      假设下刷新结果一样），也记在 #54 里。

## 4. archive

- [x] 4.1 `/opsx-archive send-page-two-steps`：`local-tools` 三条 MODIFIED 整块替换
      （保留原场景名「成功」「失败」「缩写口径」「闸关着」「改四步顺序」等——校验器报过两次
      场景名被改名，这几个必须一字不差），ADDED 一条「协议说明不承诺做不到的事」。
      验证：`--all --strict` 7 passed、无 delta 头残留、场景名全部在位；`--all --archived
    --strict` 见下。

## 回滚点

- 缩步数与删 `replyTextOf` 是同一个 commit，回滚即回到四步（#47 原样复发）。
- 协议说明的描述改动独立可回退，但它与代码必须同时（否则又对不上拍了）。
