import { ACTION_ERROR_PAGE_CHANGED, ACTION_ERROR_READ_FAILED, PageError } from "./action";
import type { ActionFrame } from "./action";
import { parseToolCall } from "./fence";
import { ledgerRole } from "./ledger";

/**
 * 读对话（`messages.list` / `messages.last`）：**只读页面渲染出来的 DOM**。
 *
 * #20 的口径（2026-10-01 改过一次）：数据源只有渲染出来的内容——不 hook 站点的请求或
 * 响应体、不解析它的消息 JSON、不直连站点接口。上一版走 `history_messages` 响应体拦截，
 * 已撤回；这里从头到尾只碰 DOM。
 *
 * 真机结构（2026-10-02 从站点页面抄的，页面 `meta[name=commit-id]` 44809ea4）：
 *
 * - **消息列表是虚拟列表**：`.ds-virtual-list` → `.ds-virtual-list-items` →
 *   `.ds-virtual-list-visible-items` → 行。只有视口里的行在 DOM（真机上 6 条消息只挂得出
 *   4 行），所以「读超出首屏的部分」= 一屏一屏往下滚、边滚边收；**滚的是哪一层要现场认**
 *   （见 `conversation`），静态看结构定不了；
 * - **行**挂 `data-virtual-list-item-key`（会话内稳定的序号），收的时候拿它去重；
 *   行自己的 class 是哈希（`_9663006` / `_4f9bf79`），**按 #15 的规矩不认它**；
 * - **角色**认设计系统类：助手行有 `.ds-assistant-message-main-content`（正文所在），
 *   用户行没有；用户行的正文包在 `.ds-collapsible-text` 里，连 19 字的短消息也包；
 * - **思考块**是 `.ds-think-content`，与正文**平级**——取正文那个类天然把它排掉，
 *   不必去猜思考块怎么折叠。
 *
 * 认不出的行一律跳过，**不猜角色**：标错角色比读不到更坏，agent 会拿它当上下文。
 */

/** 消息列表那层；认行、以及滚不动时的兜底都落它身上（滚动那层另找，见 `conversation`）。 */
const LIST_SELECTOR = ".ds-virtual-list";
/**
 * 行。两版站点都认：
 * - **老版**：行上挂 `data-virtual-list-item-key`（会话内序号）；
 * - **新版**（2026-10-04 起）：行上只有哈希 class、**没有 key**，只能按结构认——
 *   `.ds-virtual-list-visible-items`（虚拟列表最里层）的直接子元素。
 *
 * 哈希 class 不碰（见 #15），所以新版只能落到「结构位置」这条路上。`keysOf` 顺带读 key
 * （老版有、新版没有）。逗号两条各认各的，新老结构都不挑。
 */
export const ROW_SELECTOR = "[data-virtual-list-item-key], .ds-virtual-list-visible-items > *";
/** 助手正文（设计系统类）。有它就是助手，没有再看用户那条路。 */
const ASSISTANT_BODY_SELECTOR = ".ds-assistant-message-main-content";
/** 用户正文（设计系统类）。 */
const USER_BODY_SELECTOR = ".ds-collapsible-text";
/** 消息行的内层包装：有它才说明这行是一条消息（而不是分隔条之类）。 */
const MESSAGE_SELECTOR = ".ds-message";

/** 一屏一屏往下扫的硬顶：`scrollHeight` 不涨时别白转（真机一屏约几条消息）。 */
const MAX_SWEEPS = 2_000;

/**
 * 一趟扫完的墙钟硬顶：中继 `ACTION_TIMEOUT_SECONDS` 是 30s，转满 `MAX_SWEEPS` 恰好比它长，
 * 于是真原因被吞成一句 `timeout`。到点就抛，页面那边留一行日志。
 *
 * 取 25s 是量出来的：真机上虚拟列表挂载一屏新行要 ~190ms（≈12 帧，不是 1 帧），
 * 一个 385 条 / 59049px 的对话要扫 80 屏 ≈ 15s。留 25s 让它扫得完，又留 5s 余量
 * 让真失败报得出来。
 *
 * ponytail: 这是 O(消息条数) 的成本，一屏一屏等挂载，天花板就在这儿。真嫌慢就得上
 * 别的取法（比如只回摘要、或分页扫），那是另一个设计决定。
 */
const SWEEP_BUDGET_MS = 25_000;

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

/** 要单独占一行的标签：`textContent` 会把它们首尾相接，不分段就读成一坨。 */
const BLOCK_TAGS = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "DIV",
  "FIGCAPTION",
  "FIGURE",
  "FOOTER",
  "FORM",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "HR",
  "LI",
  "MAIN",
  "NAV",
  "OL",
  "P",
  "PRE",
  "SECTION",
  "TABLE",
  "TD",
  "TH",
  "TR",
  "UL",
]);

/**
 * 消息角色。`unknown` 是**认不出**时的老实答案（站点换版会让角色线索消失）——
 * 不许猜成 user / assistant：标错角色比读不到更坏（agent 会拿它当上下文）。
 */
export type MessageRole = "user" | "assistant" | "unknown";

export type Message = {
  readonly role: MessageRole;
  readonly text: string;
};

/** 两个读对话动作回同一个形状：`last` 就是最多一条的 `list`，空对话两边都 `[]`。 */
export type MessageList = {
  readonly messages: readonly Message[];
};

/**
 * 能滚的消息视口。真 DOM 的 `HTMLElement` 结构上就满足；测试里用替身喂出
 * 「滚一屏就换一批行」的假虚拟列表（jsdom 不做布局，`clientHeight` 恒为 0）。
 */
export type ListViewport = {
  querySelectorAll(selectors: string): ArrayLike<Element>;
  scrollTop: number;
  readonly clientHeight: number;
  readonly scrollHeight: number;
};

/** 视口里此刻挂着的行的 key 序列：拿它当「这一屏换没换」的凭据。 */
export function keysOf(view: ListViewport): string {
  const rows = view.querySelectorAll(ROW_SELECTOR);
  let out = "";
  for (let index = 0; index < rows.length; index += 1) {
    out += `${rows[index]?.getAttribute("data-virtual-list-item-key") ?? ""},`;
  }
  return out;
}

/**
 * 等到挂载的行**真的换了**才算这一屏到了。
 *
 * 一帧是不够的：真机上虚拟列表跟手要好几帧才挂上新的窗口（2026-10-02 实测——
 * 一帧一步地扫 80 屏只收到 50 条，而对话有 385 条）。`nextFrame` 一等就往下滚，
 * 后面几十屏看到的还是已经收过的行，于是「超出首屏」那条验收静悄悄过不去。
 * `maxFrames` 是上限：到底那一屏换不换都一样，不能白等到天荒地老。
 */
export async function settleUntilMounted(
  view: ListViewport,
  was: string,
  settle: () => Promise<void>,
  maxFrames = 30,
): Promise<void> {
  for (let frame = 0; frame < maxFrames; frame += 1) {
    await settle();
    if (keysOf(view) !== was) return;
  }
}
export function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });
}

function textOf(root: Element): string {
  const parts: string[] = [];
  const walk = (element: Element): void => {
    for (const node of element.childNodes) {
      if (node.nodeType === TEXT_NODE) {
        const raw = node.textContent ?? "";
        // 带换行的纯空白是排版（缩进），不当正文；行内的单个空格要留着，不然词会粘一起。
        if (raw.trim() === "" && raw.includes("\n")) continue;
        parts.push(raw);
        continue;
      }
      if (node.nodeType !== ELEMENT_NODE) continue;
      const child = node as Element;
      if (child.tagName === "BR") {
        parts.push("\n");
        continue;
      }
      if (child.tagName === "PRE") {
        // 新版站点（2026-10-04）把 ```send 围栏渲染成**代码块**：表头「send」+
        // 复制/下载按钮 + `<pre>` 正文——原文里的 ``` 标记在 DOM 里没了。读的时候
        // 把它还原成一段围栏：正文能解析成工具调用就写回 ```send，否则写普通的 ```。
        const body = textOf(child);
        parts.push(`\n\`\`\`${parseToolCall(body) === null ? "" : "send"}\n${body}\n\`\`\`\n`);
        continue;
      }
      if (BLOCK_TAGS.has(child.tagName)) {
        parts.push("\n");
        walk(child);
        parts.push("\n");
        continue;
      }
      walk(child);
    }
  };
  walk(root);
  return parts
    .join("")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * 读渲染要用的两件事：算出来的样式与几何。
 *
 * 留成**可注入的探测口**，因为 jsdom 不做布局——`getBoundingClientRect` 全零、
 * `getComputedStyle` 没有真底色；测试喂替身，真机走 `domProbe`。
 */
export type StyleProbe = {
  readonly style: (el: Element) => {
    readonly backgroundColor: string;
    readonly borderRadius: string;
  };
  readonly rect: (el: Element) => { readonly left: number; readonly right: number };
};

/** 真机探测口：`getComputedStyle` + `getBoundingClientRect`。 */
export const domProbe: StyleProbe = {
  style: (el) => {
    const computed = getComputedStyle(el);
    return { backgroundColor: computed.backgroundColor, borderRadius: computed.borderRadius };
  },
  rect: (el) => {
    const box = el.getBoundingClientRect();
    return { left: box.left, right: box.right };
  },
};

/** 判角色用的阈值（真机量的，见任务 research/role-bubble.md）。 */
const AVATAR_RADIUS_PX = 100; // 头像圆：30px 圆 → border-radius 100px
const BUBBLE_RADIUS_PX = 16; // 气泡 22px；助手内容块 12px（薄边界，取下界留余量）
const EDGE_EPSILON_PX = 2; // 缘对齐容差

/** `border-radius` 可能写成 `12px 12px 0px 0px`；取第一个数。 */
function radiusPx(borderRadius: string): number {
  const value = Number.parseFloat(borderRadius);
  return Number.isFinite(value) ? value : 0;
}

/** 这块真的画了底色吗（`rgba(0, 0, 0, 0)` / `transparent` 都算没画）。 */
function paints(backgroundColor: string): boolean {
  const color = backgroundColor.trim();
  return color !== "" && color !== "transparent" && color !== "rgba(0, 0, 0, 0)";
}

/**
 * 认角色的四层解析，**首个命中为准，认不出不猜**（见 `docs/adr/0014` 与
 * `guides/human-first-thinking-guide.md`）：
 *
 * 1. **载荷账本**：站点消息模型自带角色（`chat_message_role`），最硬、与标记无关；
 * 2. **标记层**：行上还留着站点的设计系统类（助手 `.ds-assistant-message-main-content`、
 *    用户 `.ds-collapsible-text`）→ 直接用（站点换版前的行为，零回归）；
 * 3. **渲染层**：人看的是**气泡**——用户消息被画成一个圆角块（真机：22px 圆角、**不满宽**，
 *    旁边还有 30px 圆头像），助手是整宽素文、一个带底色的块都没有。只认**形状 + 位置 + 头像**，
 *    **颜色不作判据**（暗色主题底色全变）；
 * 4. 都不中 → `unknown`——**不猜**：标错角色比读不到更坏（agent 会拿它当上下文）。
 */
export function roleOf(row: Element, probe: StyleProbe = domProbe): MessageRole {
  const known = ledgerRole(textOf(row));
  if (known !== null) return known;

  if (row.querySelector(ASSISTANT_BODY_SELECTOR) !== null) return "assistant";
  if (row.querySelector(USER_BODY_SELECTOR) !== null) return "user";

  const rowBox = probe.rect(row);
  if (rowBox.right - rowBox.left <= 0) return "unknown"; // 没有布局（未挂载 / jsdom）→ 判不了

  const elements = row.querySelectorAll("*");
  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index];
    if (element === undefined) continue;
    const { backgroundColor, borderRadius } = probe.style(element);
    if (!paints(backgroundColor)) continue;
    const radius = radiusPx(borderRadius);
    if (radius >= AVATAR_RADIUS_PX) return "user"; // 头像圆
    const box = probe.rect(element);
    const fullWidth = Math.abs(box.left - rowBox.left) <= EDGE_EPSILON_PX;
    if (radius >= BUBBLE_RADIUS_PX && !fullWidth) return "user"; // 气泡：不满宽的圆角块
  }
  return "assistant"; // 没有气泡：整宽素文就是助手（人也是这么看的）
}

/**
 * 一行 → 一条消息。**角色**走 `roleOf` 四层；**正文**优先取标记层的正文块
 * （不含工具条那一圈），没有就取整行文本（`rowText`，含围栏还原）。
 *
 * 站点标记层还在（这页有 `.ds-message`）、而这行没有 → 不是消息行（分隔条之类），跳过。
 */
export function readRow(row: Element, probe: StyleProbe = domProbe): Message | null {
  const text = rowText(row);
  if (text === null) return null; // 空行不算消息

  const assistant = row.querySelector(ASSISTANT_BODY_SELECTOR);
  if (assistant !== null) return { role: roleOf(row, probe), text: textOf(assistant) };
  const user = row.querySelector(USER_BODY_SELECTOR);
  if (user !== null) return { role: roleOf(row, probe), text: textOf(user) };

  const doc = row.ownerDocument;
  if (
    row.querySelector(MESSAGE_SELECTOR) === null &&
    doc !== null &&
    doc.querySelector(MESSAGE_SELECTOR) !== null
  ) {
    return null; // 标记层还在而这行没有 → 不是消息行
  }
  return { role: roleOf(row, probe), text };
}

/**
 * 一行 → 正文文本（**不看角色**）。`wait.*` 只关心正文里有没有围栏 / 回灌首行锚，
 * 不需要角色，所以在没有 role 判据的新版站点上照样能用。空文本回 `null`。
 */
export function rowText(row: Element): string | null {
  const text = textOf(row);
  return text === "" ? null : text;
}

/**
 * 这一层是不是**纵向真能滚**。光看 `scrollHeight > clientHeight` 不够：`overflow: visible`
 * 的元素内容溢出也报这个数（撑出去但不裁剪），它的 `scrollTop` 却是空操作，写下去
 * 对话一动不动，「超出首屏」那条验收照样不过。两样都得占。
 *
 * `clientHeight` 为 0 的层同样不认：看不见的一屏挪不动，扫的时候每轮只按
 * `max(1, clientHeight)` 挪 **1px**，转满 `MAX_SWEEPS` 也扫不完。留着这条是防这种层
 * 混进来——**它不是真机那次超时的原因**（那次的决定性因素是下面 `settleUntilMounted`
 * 那一头），别拿它当已验过的结论。
 */
function scrollsVertically(element: Element): boolean {
  if (element.clientHeight <= 0) return false;
  if (element.scrollHeight <= element.clientHeight + 1) return false;
  const { overflowY } = getComputedStyle(element);
  return overflowY === "auto" || overflowY === "scroll" || overflowY === "hidden";
}

/**
 * 认出消息列表，以及**真正会滚的那一层**。认不出回 null（新对话，一行都没有）。
 *
 * 滚动发生在哪一层不能靠猜：真机上 `.ds-virtual-list` 是 `display:flex` 容器、底下还压着
 * 写作框，带 `overflow` 的可能是它自己，也可能是它里面的 `.ds-virtual-list-items`。
 * 往上逐层找**真的滚得动**的才动手，找到为止，谁都不滚就落回列表那层（一屏装得下，
 * 扫一遍就够）。
 *
 * 只在行的**真祖先**里找，不进到行里面去：消息正文自己那截（长代码块之类）也会滚，
 * 拿它当列表就废了。
 *
 * `wait.*` 也要从文档里认出这一层（`wait.ts`），导出让它复用同一套判据。
 */
export function conversation(root: ParentNode): ListViewport | null {
  const row = root.querySelector(ROW_SELECTOR);
  if (row === null) return null;
  const list = row.closest(LIST_SELECTOR);
  if (list === null) throw new PageError(ACTION_ERROR_PAGE_CHANGED, "找不到消息列表"); // 结构变了：当场说，别装作空对话
  for (let element = row.parentElement; element !== null; element = element.parentElement) {
    if (scrollsVertically(element)) return element;
    if (element === list) break;
  }
  return list;
}

/** 把当前挂载的行扫进 `seen`：按 key 去重，**挂载时就读走正文**（行卸载后内容会变）。 */
function sweepInto(view: ListViewport, seen: Map<string, Message>): void {
  const rows = view.querySelectorAll(ROW_SELECTOR);
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (row === undefined) continue;
    const key = row.getAttribute("data-virtual-list-item-key");
    if (key === null || seen.has(key)) continue;
    const message = readRow(row);
    if (message !== null) seen.set(key, message);
  }
}

/**
 * 读全量：先跳到顶，再一屏一屏往下滚，每屏把没见过的行收进来，最后归位。
 * 首次扫描发生在最上面，往下收的顺序就是对话顺序，不用再按键值排序。
 *
 * **一步都挪不动就当场抛**：内容明明超长却滚不动 = 滚动层认错了（结构变了）。这时候
 * 手里只有首屏，闷声交上去 agent 会当它是一整段对话——比读不到更坏。闷着转满
 * `MAX_SWEEPS` 更不行：那是几十秒，正好把真原因吞成中继那个 30s 的 `timeout`。
 */
export async function readMessages(
  view: ListViewport,
  settle: () => Promise<void> = nextFrame,
): Promise<Message[]> {
  const seen = new Map<string, Message>();
  const home = view.scrollTop;
  const startedAt = Date.now();
  view.scrollTop = 0;
  if (home !== 0) await settle();
  for (let guard = 0; guard < MAX_SWEEPS; guard += 1) {
    sweepInto(view, seen);
    if (view.scrollTop + view.clientHeight >= view.scrollHeight - 1) break;
    const before = view.scrollTop;
    const was = keysOf(view);
    view.scrollTop += Math.max(1, view.clientHeight);
    await settleUntilMounted(view, was, settle);
    if (view.scrollTop <= before) throw new PageError(ACTION_ERROR_PAGE_CHANGED, "滚不动消息列表");
    // 越往下内容越多（边滚边加载）就会一直不到底；到点收手，别让中继替我们报 timeout
    if (Date.now() - startedAt > SWEEP_BUDGET_MS)
      throw new PageError(ACTION_ERROR_READ_FAILED, "扫不完这段对话");
  }
  view.scrollTop = home;
  return [...seen.values()];
}

/**
 * 只读最后一条：跳到底扫那一屏就够——最后一条永远躺在最底下那屏里，
 * 犯不着为了它把整段对话滚一遍。
 */
export async function readLast(
  view: ListViewport,
  settle: () => Promise<void> = nextFrame,
): Promise<Message | null> {
  const home = view.scrollTop;
  const was = keysOf(view);
  view.scrollTop = view.scrollHeight;
  await settleUntilMounted(view, was, settle);
  const seen = new Map<string, Message>();
  sweepInto(view, seen);
  view.scrollTop = home;
  return [...seen.values()].at(-1) ?? null;
}

/** `messages.list`：按序的全部消息（角色 + 文本）。新对话一行都没有，回空数组不算错。 */
export async function listMessages(_frame: ActionFrame): Promise<MessageList> {
  const view = conversation(document);
  if (view === null) return { messages: [] };
  const messages = await readMessages(view);
  // 进得来就说明挂着行（`conversation` 靠一行行找上来的），一条没读到 = 认不出结构。
  if (messages.length === 0) throw new PageError(ACTION_ERROR_PAGE_CHANGED, "认不出消息行");
  return { messages };
}

/** `messages.last`：最后一条。形状与 `list` 一致，最多一条。 */
export async function lastMessage(_frame: ActionFrame): Promise<MessageList> {
  const view = conversation(document);
  if (view === null) return { messages: [] };
  const message = await readLast(view);
  if (message === null) throw new PageError(ACTION_ERROR_PAGE_CHANGED, "认不出消息行");
  return { messages: [message] };
}
