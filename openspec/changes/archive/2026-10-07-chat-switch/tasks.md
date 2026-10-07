## 1. 存证（依赖 `adr-0018-evidence` 已合并）

- [x] 1.1 真机抓侧栏一条会话条目的整条 `outerHTML`（已登录、取非当前所在会话那条，避免带上选中态的哈希 class）与其内 `svg`
- [x] 1.2 入档 `protocol/evidence/controls.json`：`sidebar.chat-row`，`capturedOn` 写当天、`reconcile: "state-bound"`、`row` 写分组容器与同排关系、`probe` 只读表达式
- [x] 1.3 确认对拍绿（TS + pytest 两侧都过），`pnpm quality` 绿

## 2. Spec

- [x] 2.1 `frontend` spec 的候补 requirement 加 `chat.switch` 场景（定位口径 / 形状陷阱 / 参数取舍 / 只登记不进名册）——delta 已在 `specs/frontend/spec.md`，主 spec 随归档同步
- [x] 2.2 `openspec validate --all --archived --strict` 绿

## 3. 验收与提交

- [x] 3.1 提交、开 PR（`Refs #66`——#66 那 11 项候补不含本项，实现另开 change）、CI 绿后合并、删分支
- [x] 3.2 回贴说明：`chat.switch` 已登记，实现留待另一个 change（要过写动作登记闸门 + 退避 + 真机点验）
