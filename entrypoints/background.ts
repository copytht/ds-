import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";

import { askResponseMessage, parseAskRequest } from "../src/lib/channel";
import {
  FAILURE_LOG_STORAGE_KEY,
  describeLastFailure,
  markLastFailureRecovered,
  readFailureLog,
  rememberFailure,
  type FailureRecord,
  type FailureWhere,
} from "../src/lib/failurelog";
import {
  afterHealthProbe,
  badgeText,
  iconTitle,
  ICON_COLORS,
  ICON_SIZE,
  renderIcon,
  type IconState,
} from "../src/lib/icon";
import { nextMessageId } from "../src/lib/id";
import {
  FAILURE_RELAY_UNREACHABLE,
  FAILURE_UNEXPECTED_RESPONSE,
  describeFetchFailure,
  describeStatusFailure,
  parseRelayResponse,
  parseStatusResponse,
  relayAskBody,
  relayAskUrl,
  relayHealthUrl,
  relayStatusUrl,
  RELAY_HEALTH_TIMEOUT_MS,
  RELAY_STATUS_POLL_INTERVAL_MS,
  RELAY_STATUS_TIMEOUT_MS,
  RELAY_TIMEOUT_MS,
  type AskStatus,
  type StatusSnapshot,
} from "../src/lib/relay";
import {
  errorPayload,
  failureNotice,
  type FailureNotice,
  type ReplyPayload,
} from "../src/lib/reply";
import { readToggle, TOGGLE_STORAGE_KEY } from "../src/lib/toggle";

/**
 * background 这一侧干三件事：
 *
 * 1. 打中继（`POST /ask`）——网络层的失败也折成同构载荷，解析只有一条路径；
 * 2. 工具栏图标即状态位：关 / 开且中继可达 / 开但中继不可达，悬停给原因与启动命令；
 * 3. 点击图标切换总开关（总开关本身还是只存在 `storage.local`，默认关）；
 * 4. 问句在途时轮询 `GET /status`，把等待现场（阶段 / 字数 / 剩余时间）摆上角标与悬停，
 *    中继答不上来当场翻红——进度只走图标，**不进对话流**；
 * 5. 每次翻红都留一笔（时刻 / 环节 / 原因）进 `storage.local`，自己绿了再补上恢复时刻，
 *    悬停回看——否则红过就蒸发，事后没人答得出「为什么红」。
 *
 * 不建 options 页、不建 popup、不建面板（spec #9 Out of Scope）。
 */
export default defineBackground(() => {
  /** 周期探活的闹钟名与周期：30s 是 alarms 的下限，再密浏览器也不认。 */
  const HEALTH_ALARM_NAME = "relay-health";
  const HEALTH_ALARM_PERIOD_MINUTES = 0.5;

  /** 图标三态。 */
  let state: IconState = "off";
  /** 不可达时的原因与启动命令，进悬停文案。 */
  let notice: FailureNotice | null = null;
  /** 问句在途时的现场（阶段/字数/剩余时间），由 `/status` 轮询喂；空档恒为 null。 */
  let askProgress: AskStatus | null = null;
  /**
   * 失败留痕，新的在最前。启动时从 `storage.local` 载入，所以 service worker 被收走、
   * 浏览器重启都丢不了——只放内存的话，红过一次就再没人答得出「为什么红」。
   */
  let failureLog: FailureRecord[] = [];
  /** 往 storage 写留痕的串行队列：轮询每 3s 失败一次，并发的读改写会互相踩。 */
  let persistQueue: Promise<unknown> = Promise.resolve();

  function persistFailureLog(): void {
    persistQueue = persistQueue
      .then(() => browser.storage.local.set({ [FAILURE_LOG_STORAGE_KEY]: failureLog }))
      .catch(() => undefined); // 留痕写不进去不该把图标也拖死
  }

  /**
   * 记一笔故障。同一环节同一原因、且上一笔还没恢复的**不重复记**——那只是同一次
   * 故障在延续（探活每 30s、轮询每 3s 会再失败一次），留下的是故障开始的时刻。
   */
  function recordFailure(where: FailureWhere, cause: string): void {
    const next = rememberFailure(failureLog, { at: Date.now(), where, cause });
    if (next === failureLog) return;
    failureLog = next;
    persistFailureLog();
  }

  /**
   * 图标翻回绿了，给最前面那笔补上恢复时刻。
   *
   * 返回有没有真的改过——没改就不用重画，标题里那句「N 秒后恢复」也不会白拼一遍。
   */
  function recoverFailure(): boolean {
    const next = markLastFailureRecovered(failureLog, Date.now());
    if (next === failureLog) return false;
    failureLog = next;
    persistFailureLog();
    return true;
  }

  /**
   * 上图标：先拼悬停文案，再画像素；像素画不出来就退回角标，三态至少还分得开。
   *
   * 角标每次上屏都写一遍——它不再只是「画不出来时的兜底」：开着且可达时还背着
   * 等待现场（等 / 想 / 写），这是「等着的时候什么都不知道」那个缺口的出口。
   */
  async function paintIcon(): Promise<void> {
    await browser.action.setTitle({
      title: iconTitle(state, notice, askProgress, describeLastFailure(failureLog, Date.now())),
    });
    await browser.action.setBadgeText({ text: badgeText(state, askProgress) });
    try {
      await browser.action.setIcon({
        imageData: new ImageData(renderIcon(state), ICON_SIZE, ICON_SIZE),
      });
    } catch (error) {
      const [red, green, blue] = ICON_COLORS[state];
      console.log("[ds-] 图标像素画不出来，退回角标", error);
      await browser.action.setBadgeBackgroundColor({ color: `rgb(${red}, ${green}, ${blue})` });
    }
  }

  /**
   * 中继的结果 → 图标状态：成功即可达，失败把原因放进失败提示（扩展侧唯一出口）。
   * 成功顺手把留痕收尾，失败另记一笔——问句这一环跟探活不一样，它带的是中继自己
   * 的错误码（opencode 没起 / 超时 / 响应异常），比「中继不可达」有信息量得多。
   */
  function applyOutcome(payload: ReplyPayload): void {
    if (state === "off") return;
    if (payload.status === "ok") {
      state = "on-reachable";
      notice = null;
      recoverFailure();
    } else {
      state = "on-unreachable";
      notice = failureNotice(payload.error);
      recordFailure("ask", notice.reason);
      console.log(`[ds-] 问句没成（${payload.error}），已记一笔：${notice.reason}`);
    }
    void paintIcon();
  }

  async function fetchWithTimeout(
    url: string,
    timeoutMs: number,
    init?: RequestInit,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 探活：开关打开时先看中继在不在（`GET /health`）。
   *
   * 顺带把**为什么**不可达带回来。以前这里是 `catch { return false }`，超时、连不上、
   * 非 2xx 三件事被折成同一件，图标一红就再没有下文了。
   */
  async function pingRelay(): Promise<{ reachable: boolean; cause: string | null }> {
    try {
      const response = await fetchWithTimeout(relayHealthUrl(), RELAY_HEALTH_TIMEOUT_MS);
      if (!response.ok) return { reachable: false, cause: `HTTP ${response.status}` };
      return { reachable: true, cause: null };
    } catch (error) {
      return { reachable: false, cause: describeFetchFailure(error, RELAY_HEALTH_TIMEOUT_MS) };
    }
  }

  /**
   * 问一次现场：读不到体面的答案一律当「这条不可信」，不猜；同样把读不到的原因带回来。
   */
  async function readStatus(): Promise<{ snapshot: StatusSnapshot; cause: string | null }> {
    try {
      const response = await fetchWithTimeout(relayStatusUrl(), RELAY_STATUS_TIMEOUT_MS);
      const text = await response.text();
      const snapshot = parseStatusResponse(response.status, text);
      return {
        snapshot,
        cause: snapshot.reachable ? null : describeStatusFailure(response.status, text),
      };
    } catch (error) {
      return {
        snapshot: { reachable: false, ask: null },
        cause: describeFetchFailure(error, RELAY_STATUS_TIMEOUT_MS),
      };
    }
  }

  /**
   * 现场快照 → 图标。不可达就翻红挂原因；达就先把状态拨回可达，再把等待现场摆上去。
   *
   * 每回都重画是故意的：现场的价值就在「每 3s 变一次」（字数在涨、预算在走），
   * 去重反而把它省没了；真正贵的那条 30s 探活另有 `healthProbe` 自己的去重。
   */
  function applyStatus(snapshot: StatusSnapshot, cause: string | null): void {
    if (state === "off") return;
    if (!snapshot.reachable) {
      state = "on-unreachable";
      notice = failureNotice(FAILURE_RELAY_UNREACHABLE);
      askProgress = null; // 手里那份进度已经作废，留着只会误导
      recordFailure("status", cause ?? "读不到现场");
      console.log(`[ds-] 等待期问现场没答上来（${cause ?? "读不到现场"}），图标翻红`);
      void paintIcon();
      return;
    }
    if (state === "on-unreachable") {
      state = "on-reachable";
      notice = null;
      recoverFailure();
    }
    askProgress = snapshot.ask;
    void paintIcon();
  }

  /**
   * 等待期的现场轮询：每 3s 打一次 `GET /status`，把中继看到的阶段 / 字数 / 剩余时间
   * 摆到角标与悬停上。
   *
   * 「中继死了要多快发现」不需要另外立一条静默判死的规矩——每次轮询自带 5s 超时，
   * 问不到当场就红（最坏 8s），比攒到 30s 快得多。用 setTimeout 串成链，避免
   * 上一趟还没回来下一趟又压上去。
   */
  function startStatusPolling(): () => void {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function tick(): Promise<void> {
      if (stopped) return;
      const result = await readStatus();
      if (stopped) return;
      applyStatus(result.snapshot, result.cause);
      if (stopped) return;
      timer = setTimeout(() => void tick(), RELAY_STATUS_POLL_INTERVAL_MS);
    }

    void tick();
    return () => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }

  /**
   * 周期探活的排班：开着才排、关了就撤——总开关关着时扩展不该每 30s 白被叫醒一次。
   * 这条只管「中继还在不在」；问句在途时的存活另有 keepAliveWhileAsking 兜着。
   */
  async function syncHealthAlarm(enabled: boolean): Promise<void> {
    if (enabled) {
      await browser.alarms.create(HEALTH_ALARM_NAME, {
        periodInMinutes: HEALTH_ALARM_PERIOD_MINUTES,
      });
      return;
    }
    await browser.alarms.clear(HEALTH_ALARM_NAME);
  }

  /**
   * 到点探一次：中继死了图标当场翻脸，不必等下一次问句失败才暴露。
   * 状态没变就不重画——每 30s 一次，重画是白做的功。
   */
  async function healthProbe(): Promise<void> {
    const probe = await pingRelay();
    const next = afterHealthProbe(state, probe.reachable);
    const flipped = next.state !== state || next.notice !== notice;
    console.log(
      `[ds-] 周期探活：中继${probe.reachable ? "可达" : `不可达（${probe.cause ?? "原因不详"}）`}，` +
        `图标${flipped ? `翻到 ${next.state}` : "不动"}`,
    );
    // 记账不看 flipped：翻红要留痕、翻绿要收尾，没变的时候同一次故障也记不进第二笔。
    if (probe.reachable) {
      if (state === "on-unreachable") recoverFailure();
    } else {
      recordFailure("health", probe.cause ?? "原因不详");
    }
    if (!flipped) return;
    state = next.state;
    notice = next.notice;
    await paintIcon();
  }

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== HEALTH_ALARM_NAME) return;
    void healthProbe();
  });

  /**
   * MV3 的 service worker 闲置 30 秒就会被收走，而中继这一趟可能更久；
   * 答复在途时点一下扩展 API 把它按住，不改任何业务行为。
   */
  function keepAliveWhileAsking(): () => void {
    const timer = setInterval(() => {
      void browser.runtime.getPlatformInfo().catch(() => undefined);
    }, 20_000);
    return () => clearInterval(timer);
  }

  /**
   * 打中继：网络层的失败（没起、被拦、超时）也折成同构载荷。
   *
   * 在途期间另开一条 `/status` 轮询，让等待期不再是黑箱；收摊时无论成败都先把
   * 现场清掉，再由调用方上屏，免得答案都回来了角标还挂着个「写」。
   */
  async function askRelay(question: string): Promise<ReplyPayload> {
    const releaseKeepAlive = keepAliveWhileAsking();
    const stopStatusPolling = startStatusPolling();
    try {
      const response = await fetchWithTimeout(relayAskUrl(), RELAY_TIMEOUT_MS, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: relayAskBody(question),
      });
      try {
        return parseRelayResponse(response.status, await response.text());
      } catch {
        return errorPayload(FAILURE_UNEXPECTED_RESPONSE);
      }
    } catch {
      return errorPayload(FAILURE_RELAY_UNREACHABLE);
    } finally {
      stopStatusPolling();
      askProgress = null;
      releaseKeepAlive();
    }
  }

  /** 总开关变了就跟图标：关了即「关」，开了先按可达摆、再探一次中继。 */
  async function syncFromStorage(): Promise<void> {
    const stored = await browser.storage.local.get([TOGGLE_STORAGE_KEY, FAILURE_LOG_STORAGE_KEY]);
    const enabled = readToggle(stored[TOGGLE_STORAGE_KEY]);
    failureLog = readFailureLog(stored[FAILURE_LOG_STORAGE_KEY]); // 留痕先上手，标题才拼得出历史
    await syncHealthAlarm(enabled); // 排班先跟着开关走，图标再跟着探测结果走
    if (!enabled) {
      state = "off";
      notice = null;
      askProgress = null; // 关了就不该再揣着上一次等待的现场
      await paintIcon();
      return;
    }

    state = "on-reachable";
    notice = null;
    await paintIcon();

    const probe = await pingRelay();
    if (!probe.reachable) {
      if (state !== "on-reachable") return; // 等待期间开关被关掉了，别再翻红
      state = "on-unreachable";
      notice = failureNotice(FAILURE_RELAY_UNREACHABLE);
      recordFailure("health", probe.cause ?? "原因不详");
      await paintIcon();
      return;
    }
    // 探到了就说明上一次的红到此为止（包括关着浏览器时留下的那笔），补一句再画。
    if (state === "on-reachable" && recoverFailure()) await paintIcon();
  }

  // 点击图标 = 切换总开关（启动命令走悬停文案，见 #13 补充要求）。
  browser.action.onClicked.addListener(() => {
    void (async () => {
      const stored = await browser.storage.local.get(TOGGLE_STORAGE_KEY);
      const next = !readToggle(stored[TOGGLE_STORAGE_KEY]);
      await browser.storage.local.set({ [TOGGLE_STORAGE_KEY]: next });
      console.log(`[ds-] 图标被点，总开关切到${next ? "开" : "关"}`);
    })();
  });

  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (!(TOGGLE_STORAGE_KEY in changes)) return;
    void syncFromStorage();
  });

  // 隔离世界送来的问句：打中继，把同构载荷原路交回。
  browser.runtime.onMessage.addListener((message) => {
    const request = parseAskRequest(message);
    if (request === null) return undefined;
    return askRelay(request.question).then((payload) => {
      applyOutcome(payload);
      return askResponseMessage(request.id, payload);
    });
  });

  browser.runtime.onInstalled.addListener(() => {
    console.log("[ds-] installed, first message id:", nextMessageId("install"));
  });

  void syncFromStorage();
});
