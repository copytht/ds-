import type { ActionFrame } from "./actionstream";

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
/** 行：挂着虚拟列表的行 key，视口里挂载出来的才有。 */
const ROW_SELECTOR = "[data-virtual-list-item-key]";
/** 助手正文（设计系统类）。有它就是助手，没有再看用户那条路。 */
const ASSISTANT_BODY_SELECTOR = ".ds-assistant-message-main-content";
/** 用户正文（设计系统类）。 */
const USER_BODY_SELECTOR = ".ds-collapsible-text";
/** 消息行的内层包装：有它才说明这行是一条消息（而不是分隔条之类）。 */
const MESSAGE_SELECTOR = ".ds-message";

/** 一屏一屏往下扫的硬顶：`scrollHeight` 不涨时别白转（真机一屏约几条消息）。 */
const MAX_SWEEPS = 2_000;

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

export type MessageRole = "user" | "assistant";

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

/** 等一帧：虚拟列表靠滚动事件挂载行，读早了拿到的还是上一屏。 */
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
 * 一行 → 一条消息。助手认设计系统那个正文类；用户行没有它，正文在可折叠文本里。
 * 认不出的行回 `null`——**不猜角色**。
 */
export function readRow(row: Element): Message | null {
  const assistant = row.querySelector(ASSISTANT_BODY_SELECTOR);
  if (assistant !== null) return { role: "assistant", text: textOf(assistant) };
  if (row.querySelector(MESSAGE_SELECTOR) === null) return null; // 不是消息行
  const user = row.querySelector(USER_BODY_SELECTOR);
  if (user === null) return null; // 是消息行但认不出——跳过，别安个角色上去
  return { role: "user", text: textOf(user) };
}

/**
 * 这一层是不是**纵向真能滚**。光看 `scrollHeight > clientHeight` 不够：`overflow: visible`
 * 的元素内容溢出也报这个数（撑出去但不裁剪），它的 `scrollTop` 却是空操作，写下去
 * 对话一动不动，「超出首屏」那条验收照样不过。两样都得占。
 */
function scrollsVertically(element: Element): boolean {
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
 */
function conversation(root: ParentNode): ListViewport | null {
  const row = root.querySelector(ROW_SELECTOR);
  if (row === null) return null;
  const list = row.closest(LIST_SELECTOR);
  if (list === null) throw new Error("找不到消息列表"); // 结构变了：当场说，别装作空对话
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
  view.scrollTop = 0;
  if (home !== 0) await settle();
  for (let guard = 0; guard < MAX_SWEEPS; guard += 1) {
    sweepInto(view, seen);
    if (view.scrollTop + view.clientHeight >= view.scrollHeight - 1) break;
    const before = view.scrollTop;
    view.scrollTop += Math.max(1, view.clientHeight);
    await settle();
    if (view.scrollTop <= before) throw new Error("滚不动消息列表");
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
  view.scrollTop = view.scrollHeight;
  await settle();
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
  if (messages.length === 0) throw new Error("认不出消息行");
  return { messages };
}

/** `messages.last`：最后一条。形状与 `list` 一致，最多一条。 */
export async function lastMessage(_frame: ActionFrame): Promise<MessageList> {
  const view = conversation(document);
  if (view === null) return { messages: [] };
  const message = await readLast(view);
  if (message === null) throw new Error("认不出消息行");
  return { messages: [message] };
}
