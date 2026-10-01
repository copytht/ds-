/**
 * 网页**说给人听**的话：没排围栏的那些 assistant 消息，报给中继，协调者来取（`GET /said`）。
 *
 * 围栏那条路照旧（转给子 agent）；没有围栏的正常回答不再无声无息地挂在页面上等人凑巧看到。
 * 报不上不改判任何结论——这条只是「让人看见」，不是问答回路。
 */

/** 收话端点：中继本机服务，端口跟 `/send` 一样只认 dsb 的默认值。 */
export const SAID_URL = "http://127.0.0.1:8787/said";

export async function reportSaid(text: string, post: typeof fetch = fetch): Promise<void> {
  try {
    await post(SAID_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch {
    // 报不上就报不上：别把「让人看见」这件事变成链子上的一环。
  }
}

/**
 * 一条消息里**围栏之外**的部分：所有 ```send 块摘掉，剩下的给协调者看。
 *
 * 一条消息可以既有围栏（转给子 agent）又有别的话（说给人）——那些别的话不能跟着围栏一起
 * 被吞掉。摘完是空的就什么都不报。
 */
export function outsideFences(text: string): string {
  return text.replace(/```send[\s\S]*?```/g, "").trim();
}
