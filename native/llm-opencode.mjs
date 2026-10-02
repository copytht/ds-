// opencode 作 dsh 的 LLM 后端：一轮 spawn 一次 `opencode run`，把它的 NDJSON
// 事件流翻译成 dsh 的 StreamChunk。
//
// 为什么是 `opencode run` 而不是 opencode 的 HTTP 面：ACP 私有服务的模型目录恒为
// 两个余额为零的 deepseek 模型，且不吃任何配置注入（见 ADR-0009）；opencode v2 的
// HTTP 面只有 /api/*，没有 OpenAI 兼容端点。而 `opencode run --format json` 直接给
// 一条可流式解析的 NDJSON 事件流，模型也由命令行参数钉死。
//
// # ponytail: 无状态——每轮一个新 opencode 会话，全历史靠渲染进 prompt 传过去。
// token 成本随对话变长而涨；要复用会话就去解析 opencode 的事件流做增量续接。
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { LlmAdapter } from "@deepseek-ai/dsh-llm";

export const PROVIDER = "opencode";

/** 取一条消息的纯文本正文；非文本块（图片、工具结果）在本接缝里不参与渲染。 */
function textOf(message) {
  const { content } = message;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block?.type === "text")
    .map((block) => block.text ?? "")
    .join("\n");
}

/**
 * 把 dsh 的一条请求拍平成给 opencode 的单个问句。opencode 那边是新会话，所以这里必须
 * 自带全部上文：system 提示在前，其后按角色分段。第一条 system-role 消息与
 * `options.system` 合并，只保留一次。
 */
export function renderPrompt(options) {
  const sections = [];
  const seenSystem = new Set();
  const pushSystem = (text) => {
    if (!text || seenSystem.has(text)) return;
    seenSystem.add(text);
    sections.push(text);
  };
  pushSystem(options.system);
  for (const message of options.messages) {
    const text = textOf(message);
    if (!text) continue;
    if (message.role === "system") pushSystem(text);
    else sections.push(`${message.role ?? "user"}:\n${text}`);
  }
  return sections.join("\n\n");
}

/** 非零退出时把 stderr 尾巴带进异常，免得回灌一句没头没尾的失败。 */
function spawnOpencode(options, cwd) {
  return spawn(
    "opencode",
    [
      "run",
      "--format",
      "json",
      // 子 agent 跑 bash / 测试要过权限门；这里等价于旧链路的 permission: allow。
      "--auto",
      "--model",
      `${options.provider}/${options.model}`,
      renderPrompt(options),
    ],
    { cwd, stdio: ["ignore", "pipe", "pipe"] },
  );
}

class OpencodeAdapter extends LlmAdapter {
  constructor({ cwd }) {
    super();
    this.cwd = cwd;
  }

  providerInfo(provider) {
    return { id: provider, name: "OpenCode" };
  }

  listModels(_provider) {
    // 目录留空：核心路由接受未登记的 model id，GUI 之外没有挑选器的用武之地。
    return Promise.resolve([]);
  }

  // dsh 会校验这份精确模型元数据：provider / id 必须与请求逐字相符，name 必填
  // （`normalizeModelInfo`，否则报 INVALID_MODEL_INFO）。上下文窗口之类的能力字段
  // 留空——opencode 自己管，我们不替它编。
  resolveModel(provider, model) {
    return Promise.resolve({ provider, id: model, name: model });
  }

  async *stream(options) {
    const child = spawnOpencode(options, this.cwd);
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-2000);
    });

    const abort = () => child.kill("SIGKILL");
    options.signal?.addEventListener("abort", abort, { once: true });
    // 信号已到达才 spawn 的情形：此刻补一次 kill，免得白等一轮。
    if (options.signal?.aborted) abort();

    let started = false;
    let emitted = "";
    try {
      for await (const line of createInterface({ input: child.stdout })) {
        if (!line.trim()) continue;
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }
        // opencode 反复推送同一个 part 的累积文本，只把多出来的尾巴发下去。
        if (event.type !== "text") continue;
        const text = event.part?.text ?? "";
        if (!text || text === emitted) continue;
        const delta = text.startsWith(emitted) ? text.slice(emitted.length) : text;
        emitted = text;
        if (!delta) continue;
        if (!started) {
          started = true;
          yield { type: "block-start", index: 0, blockType: "text" };
        }
        yield { type: "text-delta", index: 0, text: delta };
      }
    } finally {
      options.signal?.removeEventListener("abort", abort);
    }

    const code = await new Promise((resolve) => {
      child.once("close", resolve);
    });
    if (options.signal?.aborted) return;
    if (code !== 0) {
      throw new Error(`opencode run 退出码 ${code}: ${stderr.trim()}`);
    }
    if (started) yield { type: "block-end", index: 0, block: { type: "text", text: emitted } };
    else {
      yield { type: "block-start", index: 0, blockType: "text" };
      yield { type: "block-end", index: 0, block: { type: "text", text: "" } };
    }
    yield { type: "finish", reason: "stop" };
  }
}

/** 把一条 provider 路由接到这个适配器上；随 fiber 卸载而释放。 */
export function registerOpencodeLlm(ctx, options) {
  return ctx.llm.registerAdapter([PROVIDER], new OpencodeAdapter(options));
}
