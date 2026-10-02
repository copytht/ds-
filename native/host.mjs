// host：中继的子会话宿主。stdio 上讲行 JSON，把网页的一问交给 dsh 的 continuable
// subagent，模型那一跳走 opencode（见 llm-opencode.mjs 与 ADR-0009）。
//
// 线协议（每行一个 JSON 对象，请求与回应共用 stdin/stdout，一问一回，不轮询）：
//
//   {"op":"ping"}
//     → {"ok":true,"providers":["spawn"],"pages":<已建 parent 数>,"children":<活 child 数>}
//   {"op":"ask","page":"<网页会话 id>","question":"…"}
//     → {"ok":true,"childId":"…","stopReason":"completed","answer":"…"}
//   {"op":"interrupt","page":"<网页会话 id>"}
//     → {"ok":true} | {"ok":false,"error":"no child"}
//
// 开场白不在这里加：`dsb/server.py` 的 answer_prompt 已经在措辞，host 只做编排。
import { createInterface } from "node:readline";
import { join } from "node:path";
import { Context } from "@deepseek-ai/cordis";
import { AgentRegistry } from "@deepseek-ai/dsh-agent";
import { SessionStore } from "@deepseek-ai/dsh-session";
import { ToolRuntime } from "@deepseek-ai/dsh-tools";
import { SystemPrompt } from "@deepseek-ai/dsh-system-prompt";
import { SessionProjectionRegistry } from "@deepseek-ai/dsh-session-projection";
import { LlmRuntime } from "@deepseek-ai/dsh-llm";
import { AgentLoop } from "@deepseek-ai/dsh-agent-loop";
import { SubagentRuntime } from "@deepseek-ai/dsh-subagent";
import sessionQuery from "@deepseek-ai/dsh-session-query";
import * as spawnInProcess from "@deepseek-ai/dsh-subagent-spawn-in-process";
import jsonlPersistence from "@deepseek-ai/dsh-session-persistence-jsonl";
import { registerOpencodeLlm } from "./llm-opencode.mjs";

const PROVIDER = "spawn";

/** 插件之间有 inject 依赖，逐个 await：不等 Fiber 就绪，下一个就看不到服务。 */
const PLUGINS = [
  SessionStore,
  // 续问走冷恢复时要读回 child 的持久日志（`CONTINUATION_UNAVAILABLE` 说缺的就是它）。
  sessionQuery,
  ToolRuntime,
  SystemPrompt,
  SessionProjectionRegistry,
  LlmRuntime,
  AgentRegistry,
  AgentLoop,
  SubagentRuntime,
  spawnInProcess,
];

/** 把 `subagent/end` 的终态消息拍平成一句文本。 */
export function answerOf(end) {
  return (end?.lastAssistantMessage ?? [])
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
}

/**
 * 终态通道：dsh 那边一问一答是异步的，两边谁先到都可能。
 *
 * 曾经把「先到了没人取的 end」和「已经挂上等的人」塞进同一个数组，结果先到的 end
 * 会把后来挂上的 resolver 挤走，promise 永不落定——问一句等到进程因为没活干而退出。
 * 两边分开摆就干净了。
 */
export function createTurnChannel() {
  const turns = new Map();
  function channel(childId) {
    let found = turns.get(childId);
    if (found === undefined) turns.set(childId, (found = { ends: [], resolvers: [] }));
    return found;
  }
  return {
    /** 收到一个 child 的终态：有人等就给他，没人等就先存着。 */
    deliver(end) {
      const { ends, resolvers } = channel(end.id);
      const resolve = resolvers.shift();
      if (resolve) resolve(end);
      else ends.push(end);
    },
    /** 等这个 child 的下一个终态，按问的先后交付。 */
    settle(childId) {
      const { ends, resolvers } = channel(childId);
      if (ends.length) return Promise.resolve(ends.shift());
      return new Promise((resolve) => resolvers.push(resolve));
    },
  };
}

export async function startHost({ cwd = process.cwd(), model = "big-pickle" } = {}) {
  const ctx = new Context();
  for (const plugin of PLUGINS) await ctx.plugin(plugin, {});
  // continuable 硬性要求持久化后端（`PERSISTENCE_UNAVAILABLE`）：续问靠重开 durable
  // session log 重建 child 的上下文。`dsh-session-persistence` 本身只是个空壳 face，
  // 真正落盘的是 jsonl 后端。
  await ctx.plugin(jsonlPersistence, { root: join(cwd, ".dsh-state", "sessions") });
  registerOpencodeLlm(ctx, { cwd });
  const route = { provider: "opencode", model };

  /**
   * 网页会话 id → 活 parent 身份，一个真实 Agent（自带 session）。
   *
   * 试过鸭子类型 `{ id }`，但 dsh 沿血缘与继承一路往下读 `session.header.parentSession`、
   * `options.subagentDepth`、`session.requestHeader()`、`session.header.delegationDepth`，
   * 补完一个又炸下一个。走 `ctx.agents.create()`，由 loop 的 factory 造一条真 session
   * —— 这也正是 continuation 冷恢复需要的东西。
   *
   * 一律按会话 id 缓存：重复注册会抛，且 child 的 `parent-unavailable` 校验要求
   * parent 在续问时仍然 live。
   */
  const parents = new Map();
  /** 网页会话 id → 它的 continuable child。第一问建，之后每问都续同一个。 */
  const children = new Map();

  const turns = createTurnChannel();
  ctx.on("subagent/end", (end) => turns.deliver(end));

  async function parentOf(pageId) {
    if (typeof pageId !== "string" || pageId === "") {
      // 空 id 会拼出坏的 session 落盘路径；报一句人看得懂的，别让它走进 dsh 的栈。
      throw new Error("ask 缺 page");
    }
    let handle = parents.get(pageId);
    if (!handle) {
      try {
        handle = await ctx.agents.create({ sessionId: pageId, meta: { cwd }, agentOptions: route });
      } catch (error) {
        // 进程重启后同一个 page 还躺在盘上（jsonl 持久日志正是为这个留的）：**冷恢复它**，
        // 不是重起——重起撞 SessionAlreadyExistsError，且会丢掉此前的上下文。
        if (error?.name !== "SessionAlreadyExistsError") throw error;
        handle = await ctx.agents.resume({ resumeSessionId: pageId, agentOptions: route });
      }
      parents.set(pageId, handle);
    }
    return handle.agent;
  }

  /** 等这个 child 的下一个终态。 */
  function settle(childId) {
    return turns.settle(childId);
  }

  /**
   * 问一轮。首问建 child，续问投递进同一 child 的 inbox 排下一轮（`delivery: "queue"`：
   * 网页不该把正在跑的那一轮切掉；要切走 interrupt）。
   */
  async function ask({ page, question, signal = new AbortController().signal }) {
    const parent = await parentOf(page);
    let childId = children.get(page);
    if (childId === undefined) {
      const started = await ctx.subagents.startContinuable({
        provider: PROVIDER,
        label: "dsb",
        request: { parent, prompt: [{ type: "text", text: question }], agentOptions: route },
        signal,
      });
      childId = started.childId;
      children.set(page, childId);
    } else {
      await ctx.subagents.prompt(
        {
          requestId: crypto.randomUUID(),
          parentSessionId: parent.id,
          childSessionId: childId,
          mode: "continuable",
          delivery: "queue",
          content: [{ type: "text", text: question }],
        },
        signal,
      );
    }
    const end = await settle(childId);
    return { childId, stopReason: end.stopReason, answer: answerOf(end) };
  }

  /** 切掉这个网页会话正在跑的那一轮；排队中的问题留着，child 不散。 */
  function interrupt(page) {
    const childId = children.get(page);
    if (childId === undefined) return { ok: false, error: "no child" };
    return ctx.subagents.interrupt(childId, { kind: "user", parentSessionId: page });
  }

  return {
    ctx,
    ask,
    interrupt,
    stats: () => ({ pages: parents.size, children: children.size }),
  };
}

export async function serveStdio(host) {
  const write = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
  // 同一个 page 的问句串行，不同 page 各走各的：续问要排在上一轮后面才接得上上文。
  const inflight = new Map();
  async function dispatch(request) {
    switch (request.op) {
      case "ping":
        return { ok: true, providers: [PROVIDER], ...host.stats() };
      case "ask": {
        const previous = inflight.get(request.page) ?? Promise.resolve();
        const next = previous.then(() => host.ask(request));
        // 串行链上只挂成功的一环：问句失败不该把后面的问句一起带走。
        inflight.set(
          request.page,
          next.catch(() => undefined),
        );
        return { ok: true, ...(await next) };
      }
      case "interrupt":
        return { ok: true, ...host.interrupt(request.page) };
      default:
        return { ok: false, error: `unknown op: ${request.op}` };
    }
  }

  for await (const line of createInterface({ input: process.stdin })) {
    if (!line.trim()) continue;
    let request;
    try {
      request = JSON.parse(line);
    } catch {
      write({ ok: false, error: "bad json" });
      continue;
    }
    // 不 await：读循环必须一直读得动，否则问句在途时 interrupt 根本递不进来。
    // 回应按请求带的 id 回，中继那边按 id 认领（见 HostProcess.call）。
    void dispatch(request)
      .then((payload) => write({ ...payload, id: request.id }))
      .catch((error) =>
        write({ ok: false, error: String(error?.message ?? error), id: request.id }),
      );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await serveStdio(await startHost());
}
