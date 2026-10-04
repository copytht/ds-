# 目录结构

## 三个世界，五個入口

`entrypoints/` 是 WXT 的入口层，只做接线，不放可单测的逻辑：

| 文件 | 世界 | 职责 |
| --- | --- | --- |
| `background.ts` | service worker | **唯一打网络的地方**：MCP 调用（`src/lib/relay.ts`）、角标、看门狗、动作下发 |
| `content.ts` | 隔离世界 | chain 消息与 runtime 消息的中转、协议说明注入时机、said 转发 |
| `inject.content.ts` | MAIN（页面）世界 | 检出 ```send 围栏、回灌锚、与页面 DOM 打交道 |
| `popup/main.ts`、`options/main.ts` | 页面 | 薄壳（各十几行），读写开关与看门狗配置，逻辑都在 `src/lib` |

## `src/lib/` 纯逻辑层

- **一主题一文件，测试同名共置**：`relay.ts` ↔ `relay.test.ts`、`gate.ts` ↔ `gate.test.ts`。
  新模块照这个来，vitest 直接 `pnpm test`。
- 主题分参考：`fence`（围栏）、`channel`（消息信封）、`relay`（MCP 客户端）、`gate`（唯一出站口）、
  `backoff`/`watchdog`/`wait`（催办与等待）、`icon`（角标）、`failurelog`（失败留痕）、
  `instructions`（协议说明）、`fixtures`（读 `protocol/fixtures/`）。
- **不碰 console**：eslint 对 `src/**` 禁 console（仅许 `warn`/`error`），输出走返回值或 logger；
  console 留给 entrypoints——浏览器控制台就是那里的调试通道。
- **不直接访问站点**：`tests/test_no_direct_site_access.py` 静态扫描 `src/`、`entrypoints/`、
  `dsb/`、`wxt.config.ts`，站点地址豁免名单是白名单制，扩豁免要跟着该测试的注释走。
- **不 fetch**：MAIN 与隔离世界一律不发网络请求（规避 CORS），fetch 只出现在 background 调的
  `src/lib/relay.ts` 里。

## 反模式

- 把逻辑写进 entrypoints → 进不了单测（`content.ts`/`background.ts` 只剩接线才是健康的）。
- 在 `content.ts` 里直接 `fetch` 中继或站点 → 撞 CORS，且破静态守卫。
- 为一个只在一处用到的小逻辑新建 `src/lib` 模块前，先看 `backoff`/`wait`/`gate`/`id` 有没有现成的。
