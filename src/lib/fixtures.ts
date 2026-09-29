/**
 * 共享线协议 fixture 的扩展侧 schema 与加载器。
 * `protocol/fixtures/*.json` 由 vitest 与 pytest 共读，两半各持一份 schema。
 */

import type { ReplyPayload } from "./reply";

export type FixtureFile<T> = {
  readonly description: string;
  readonly cases: readonly T[];
};

/** 围栏解析对拍（`fence.json`）。 */
export type FenceCase = {
  readonly name: string;
  readonly input: string;
  readonly expectedQuestion: string | null;
};

/** 回灌组装对拍（`reply.json`）。 */
export type ReplyCase = {
  readonly name: string;
  readonly payload: ReplyPayload;
  readonly expectedMessage: string;
};

/** 中继结果 → 载荷对拍（`opencode.json`）。 */
export type OpencodeCase = {
  readonly name: string;
  readonly outcome: { readonly kind: string; readonly body?: unknown; readonly status?: number };
  readonly expectedPayload: ReplyPayload;
};

/** 配置解析对拍（`config.json`）。 */
export type ConfigCase = {
  readonly name: string;
  readonly kind: string;
  readonly input: string;
  readonly expected: Readonly<Record<string, unknown>>;
};

const MODULES = import.meta.glob<FixtureFile<unknown>>("../../protocol/fixtures/*.json", {
  eager: true,
  import: "default",
});

const FILES = new Map<string, FixtureFile<unknown>>(
  Object.entries(MODULES).map(([path, file]) => [path.split("/").pop() ?? path, file]),
);

/** 所有共享 fixture 的文件名（含扩展名），按字典序。 */
export const FIXTURE_FILENAMES = [...FILES.keys()].sort();

/** 读一个共享 fixture；缺文件直接抛，免得测试静默跳过。 */
export function fixtureFile(filename: string): FixtureFile<unknown> {
  const file = FILES.get(filename);
  if (!file) throw new Error(`共享 fixture 缺失：protocol/fixtures/${filename}`);
  return file;
}

/** 读一个共享 fixture 的 cases，按各自的 schema 断言用。 */
export function fixtureCases<T>(filename: string): readonly T[] {
  return fixtureFile(filename).cases as readonly T[];
}
