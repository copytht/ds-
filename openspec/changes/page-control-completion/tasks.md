## 1. Spec 文字升级（仅修改 `openspec/specs/frontend/spec.md`）

- [x] 1.1 将「页面动作的候补控件只登记、不进名册」requirement 的定位列从「待真机确认」替换为真机实测口径（消息工具栏六项、代码块两项、页头分享、侧栏搜索/收起）
- [x] 1.2 将「用途没认出」场景里的待查项结掉：页头分享、侧栏搜索/收起边栏→已识别并登记动作名与定位；模型选择→记「当前 UI 未见」
- [x] 1.3 在「为什么这些项只是登记」场景里显式列出 v1 名册已含的 15 条动作（`think.*`/`search.*`/`button.*`/`send.enter`/`chat.new`/`wait.*`/`messages.*`/`composer.*`/`tabs.list`/`page.state`），与候补项对比，明确边界
- [x] 1.4 在「候补项要上真机」场景里补充：须满足 ADR-0018 的真机存证对拍要求

## 2. 验收与提交

- [x] 2.1 跑 `openspec validate --all --archived --strict` 确认 7/7 通过
- [x] 2.2 跑 `pnpm quality` 确认全绿（仅 spec 变更不应触发代码侧失败）
- [x] 2.3 提交变更、开 PR、CI 绿后合并、删分支
- [x] 2.4 回贴 #30 关票（含真机证据摘要、未验证项说明）
