# 代码复用：先找，再写

本仓库很小（扩展层 ~8700 行含测试，dsb 六个模块），新逻辑大概率撞上一件近亲。
落笔前按这张表找：

| 你想写 | 先看 |
| --- | --- |
| 解析跨边界载荷 | `src/lib/channel.ts` 的 `parse*` 家族 |
| 构造跨边界消息 | `channel.ts` 的 `*Message()` 家族（与 parse 成对） |
| 定时器 / 周期检查 | `src/lib/wait.ts`、`watchdog.ts` |
| 退避 / 冷却 | `src/lib/backoff.ts` |
| 发消息到页面 | **唯一出站口** `src/lib/gate.ts`（ADR-0002）——不存在第二条路径 |
| 唯一 id | `src/lib/id.ts` |
| 读/写 storage 键 | 各模块的 `*_STORAGE_KEY` 常量（`toggle.ts`、`ask.ts`…） |
| 与 MCP server 说话 | `src/lib/relay.ts`（客户端）与 `dsb/gateway.py`（网关侧） |
| 拼协议说明 | `src/lib/instructions.ts` |
| 失败码 | 三本册子（见 `../backend/error-handling.md`） |

## 判断标准

- **语义相同 ≠ 可以复用**：两个形状不同的解析需求各写各的 parse，
  复用的是「过 parse」这条纪律，不是函数本身。
- **为了复用而抽象**是反模式：本仓库没有抽象工厂、没有基类，
  只有主题文件。
- 复用到第三处才抽：`backoff` 用了三处才值得有自己的文件。

## 反模式

- 在 `entrypoints/` 里写「就这一行」的逻辑——进 `src/lib` 才能单测。
- 复制一个 parse 函数再改两个字段——在原 parse 上加分支，或加新
  判别字段，构造/解析成对改。
