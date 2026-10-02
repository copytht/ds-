// host：中继的子会话宿主。stdio 上讲行 JSON。挂载链已验证可用（11 个插件，
// 服务全起，opencode provider 在册）；问一轮的编排见文件末尾的说明。
//
// 线协议（每行一个 JSON 对象）：
//
//   {"op":"ping"}  → {"ok":true,"providers":["spawn"],"pages":<已注册 parent 数>}
//
import { createInterface } from "node:readline";
import { Context } from "@deepseek-ai/cordis";
import { AgentRegistry } from "@deepseek-ai/dsh-agent";
import { SessionStore } from "@deepseek-ai/dsh-session";
import { ToolRuntime } from "@deepseek-ai/dsh-tools";
import { SystemPrompt } from "@deepseek-ai/dsh-system-prompt";
import { SessionProjectionRegistry } from "@deepseek-ai/dsh-session-projection";
import { LlmRuntime } from "@deepseek-ai/dsh-llm";
import { SessionPersistence } from "@deepseek-ai/dsh-session-persistence";
import { AgentLoop } from "@deepseek-ai/dsh-agent-loop";
import { SubagentRuntime } from "@deepseek-ai/dsh-subagent";
import * as spawnInProcess from "@deepseek-ai/dsh-subagent-spawn-in-process";
import * as jsonStorage from "@deepseek-ai/dsh-storage-json";
import { registerOpencodeLlm } from "./llm-opencode.mjs";

/** 插件之间有 inject 依赖，逐个 await：不等 Fiber 就绪，下一个就看不到服务。 */
const PLUGINS = [
  jsonStorage,
  SessionStore,
  SessionPersistence,
  ToolRuntime,
  SystemPrompt,
  SessionProjectionRegistry,
  LlmRuntime,
  AgentRegistry,
  AgentLoop,
  SubagentRuntime,
  spawnInProcess,
];

export async function startHost({ cwd = process.cwd() } = {}) {
  const ctx = new Context();
  for (const plugin of PLUGINS) await ctx.plugin(plugin, {});
  registerOpencodeLlm(ctx, { cwd });

  /**
   * 网页会话 id → 活 parent 身份。dsh 要求给 continuable child 投递时经由 exact live
   * direct parent（否则 `subagent/parent-unavailable`），而 Agent 的公开形状只有 id，
   * 所以每个网页会话注册一次、长期持有。重复注册会抛，所以必须缓存。
   */
  const parents = new Map();
  function parentOf(pageId) {
    let parent = parents.get(pageId);
    if (!parent) {
      parent = { id: pageId };
      ctx.agents.register(parent);
      parents.set(pageId, parent);
    }
    return parent;
  }

  return { ctx, parentOf };
}

/**
 * 问一轮要接的三条 dsh 调用（形状已确认，答案读取那一段还没接）：
 *
 *   首问  ctx.subagents.startContinuable({ provider:"spawn", label, request, signal })
 *         request = { parent, prompt: ContentBlock[] }，signal 必填
 *         → { childId, messageId }
 *   续问  ctx.subagents.prompt({ parentSessionId, childSessionId, mode:"continuable",
 *                                delivery:"queue"|"steer", content, requestId }, signal)
 *         纯数据，不需要 Agent 对象；requestId 由调用方自铸并持久化
 *   中断  ctx.subagents.interrupt(childId, { kind:"user", parentSessionId })
 */
export async function serveStdio(host) {
  const write = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
  for await (const line of createInterface({ input: process.stdin })) {
    if (!line.trim()) continue;
    let request;
    try {
      request = JSON.parse(line);
    } catch {
      write({ ok: false, error: "bad json" });
      continue;
    }
    if (request.op === "ping") {
      write({ ok: true, providers: ["spawn"], pages: host.parents?.size ?? 0 });
    } else {
      write({ ok: false, error: `unknown op: ${request.op}` });
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const host = await startHost();
  host.parents = new Map();
  await serveStdio(host);
}
