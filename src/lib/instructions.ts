/**
 * 协议说明：拼在用户每条消息开头、教网页模型排围栏的那段文字。
 * 文案取自 spec #9，逐字照抄，不要改写。
 */

export const PROTOCOL_INSTRUCTIONS = `【ds 协议】需要写代码、查本机或需要第二双眼时，可以把问题交给本机的编码 agent。
把问题排成一个围栏块，然后停止回答、等待回灌：

\`\`\`ask <question>
\`\`\`

- <question> 换成问题正文，可以多行，用单独一行 \`\`\` 结束。
- 一次回答最多排一块；排完就停，不要替它往下写。
- 它的回答以 \`agent:\` 开头、TOON 格式，status: ok 时 answer 是正文。
- 若没有收到 \`agent:\` 回灌，说明这次没问成：不要追问、不要重排，当作没问过，继续别的内容。
- 用不到 agent 时忽略本说明。`;

/** 把协议说明拼到一条用户消息的开头（注入通过改写用户消息实现）。 */
export function prependInstructions(message: string): string {
  return `${PROTOCOL_INSTRUCTIONS}\n\n${message}`;
}
