## 1. 执行器

- [ ] 1.1 `src/lib/page.ts`：加常量 `TOGGLE_SETTLE_MS = 1500`、`TOGGLE_POLL_MS = 50`；`setToggleOption` 点完轮询 `aria-pressed`——到目标态立即收，超上限按当时读到的收；幂等路径（已在目标态）不点不轮询、立即回
- [ ] 1.2 `setThink` / `setSearch` 跟着变 async；`entrypoints/content.ts` 的名册不用改（值类型允许 Promise），确认类型检查过

## 2. 测试

- [ ] 2.1 `src/lib/page.test.ts`：现有 set 用例改 `await`；「站点没拨过去」用例用 fake timers 推进到上限，断言回的是未变的值
- [ ] 2.2 新增「站点异步生效」用例：点击后延迟（上限内）才把 `aria-pressed` 改成 true，断言回 `{ enabled: true }`；且先于上限就返回（不等满）
- [ ] 2.3 新增：幂等路径不轮询（已在目标态时 fake timers 不推进也能立刻回）
- [ ] 2.4 先让新用例在旧实现上**红**（暂存旧实现跑一遍），再改回——确认它真的在测这个 bug
- [ ] 2.5 `pnpm quality` 绿

## 3. 探针与真机

- [ ] 3.1 `scripts/page-action.py` 的 `toggles_off`：去掉自己的 `.get` 轮询，信任 `set` 返回（`enabled === false` 才算关上）
- [ ] 3.2 真机：把两个开关先拨开，`send think.set {enabled:false}` 一次就回 `{enabled:false}`（不再读到旧值）；`toggles-off` 一次过
- [ ] 3.3 `env-up.sh --debug` 里的 `toggles-off` 仍正常

## 4. 收尾

- [ ] 4.1 `openspec validate --all --archived --strict` 绿；提交、开 PR（`Fixes #81`）、CI 绿后合并、删分支
- [ ] 4.2 归档本 change（delta 同步进 `site-dom` 主 spec）
