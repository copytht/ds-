import { describe, expect, it } from "vitest";

import {
  FIXTURE_FILENAMES,
  fixtureCases,
  fixtureFile,
  type ActionCase,
  type ActionFixtureFile,
  type ConfigCase,
  type FenceCase,
  type OpencodeCase,
  type ReplyCase,
} from "./fixtures";
import { isKnownFailureKind, REPLY_ANCHOR } from "./reply";

const EXPECTED_FILES = ["action.json", "config.json", "fence.json", "opencode.json", "reply.json"];

const KNOWN_OUTCOME_KINDS = ["success", "not-running", "timeout", "http-error"];
const KNOWN_CONFIG_KINDS = ["port", "password", "session-id"];

function rawCases(filename: string): Record<string, unknown>[] {
  return fixtureFile(filename).cases.map((oneCase) => {
    if (typeof oneCase !== "object" || oneCase === null || Array.isArray(oneCase)) {
      throw new Error(`${filename} 的 case 不是对象：${JSON.stringify(oneCase)}`);
    }
    return oneCase as Record<string, unknown>;
  });
}

function expectReplyPayload(value: unknown): void {
  const record = rawPayload(value);
  expect(["ok", "error"]).toContain(record["status"]);
  if (record["status"] === "ok") {
    expect(typeof record["answer"]).toBe("string");
    expect(record).not.toHaveProperty("error");
  } else {
    expect(typeof record["error"]).toBe("string");
    expect(record).not.toHaveProperty("answer");
  }
}

function rawPayload(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`载荷不是对象：${JSON.stringify(value)}`);
  }
  return value as Record<string, unknown>;
}

describe("共享 fixture 完整性", () => {
  it("五个 fixture 都在，且两半按同一份清单读", () => {
    expect(FIXTURE_FILENAMES).toEqual(EXPECTED_FILES);
  });

  it.each(EXPECTED_FILES)("%s 有说明与非空 cases", (filename) => {
    const file = fixtureFile(filename);
    expect(file.description.length).toBeGreaterThan(0);
    expect(file.cases.length).toBeGreaterThan(0);
  });

  it.each(EXPECTED_FILES)("%s 的 case 名不重样", (filename) => {
    const names = rawCases(filename).map((oneCase) => oneCase["name"]);
    for (const name of names) expect(typeof name).toBe("string");
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("围栏 fixture 自洽", () => {
  it("抽出问题的输入里必须排着 ```say 围栏", () => {
    for (const { input, expectedQuestion } of fixtureCases<FenceCase>("fence.json")) {
      if (expectedQuestion !== null) expect(input).toContain("```say");
    }
  });
});

describe("回灌 fixture 自洽", () => {
  it("载荷符合 status + answer/error 的同构形状", () => {
    for (const { payload } of fixtureCases<ReplyCase>("reply.json")) {
      expectReplyPayload(payload);
    }
  });

  it("预期消息首行是首行锚，且带着载荷", () => {
    for (const { expectedMessage } of fixtureCases<ReplyCase>("reply.json")) {
      const lines = expectedMessage.split("\n");
      expect(lines[0]).toBe(REPLY_ANCHOR);
      expect(lines.slice(1).join("\n")).toContain("status:");
    }
  });

  it("正文里没有换行转义（解码方是 LLM，字面 \\n 它不会还原）", () => {
    for (const { expectedMessage } of fixtureCases<ReplyCase>("reply.json")) {
      expect(expectedMessage).not.toMatch(/\\n/);
    }
  });
});

describe("中继 fixture 自洽", () => {
  it("预期载荷符合 status + answer/error 的同构形状", () => {
    for (const { expectedPayload } of fixtureCases<OpencodeCase>("opencode.json")) {
      expectReplyPayload(expectedPayload);
    }
  });

  it("只覆盖已知的 outcome 分支", () => {
    for (const { outcome } of fixtureCases<OpencodeCase>("opencode.json")) {
      expect(KNOWN_OUTCOME_KINDS).toContain(outcome.kind);
    }
  });

  it("error 分支的错误码扩展侧都有失败提示（对拍）", () => {
    for (const { expectedPayload } of fixtureCases<OpencodeCase>("opencode.json")) {
      if (expectedPayload.status === "error") {
        expect(isKnownFailureKind(expectedPayload.error)).toBe(true);
      }
    }
  });
});

describe("回灌载荷与中继载荷对拍", () => {
  it("回灌 fixture 里的载荷都能由中继的映射产出", () => {
    const relayPayloads = fixtureCases<OpencodeCase>("opencode.json").map(
      ({ expectedPayload }) => expectedPayload,
    );
    for (const { payload } of fixtureCases<ReplyCase>("reply.json")) {
      expect(relayPayloads).toContainEqual(payload);
    }
  });
});

describe("配置 fixture 自洽", () => {
  it("只覆盖已知的解析分支，且输入输出都是字符串", () => {
    for (const { name, kind, input, expected } of fixtureCases<ConfigCase>("config.json")) {
      expect(KNOWN_CONFIG_KINDS).toContain(kind);
      expect(typeof name).toBe("string");
      expect(typeof input).toBe("string");
      expect(typeof expected).toBe("object");
    }
  });
});

describe("动作 fixture 自洽", () => {
  it("失败码册子里 code 不重样、when 非空", () => {
    const file = fixtureFile("action.json") as ActionFixtureFile;
    const codes = file.errorCodes.map(({ code, when }) => {
      expect(typeof code).toBe("string");
      expect(code.length).toBeGreaterThan(0);
      expect(typeof when).toBe("string");
      expect(when.length).toBeGreaterThan(0);
      return code;
    });
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("每个 case：请求体三条字段在场，响应回同一个 action", () => {
    for (const { request, response } of fixtureCases<ActionCase>("action.json")) {
      expect(typeof request.action).toBe("string");
      expect(request.params).toBeTypeOf("object");
      expect(request.target === null || typeof request.target === "string").toBe(true);
      expect(response.action).toBe(request.action);
    }
  });

  it("成功不带 error、失败带册子上的码（对拍）", () => {
    const codes = (fixtureFile("action.json") as ActionFixtureFile).errorCodes.map(
      ({ code }) => code,
    );
    for (const { name, response } of fixtureCases<ActionCase>("action.json")) {
      if (response.ok) {
        expect(response).not.toHaveProperty("error");
        expect(response).toHaveProperty("result");
      } else {
        expect(codes).toContain(response.error);
        expect(response).not.toHaveProperty("result");
      }
      expect(typeof name).toBe("string");
    }
  });
});
