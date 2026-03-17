import { describe, test, expect, beforeEach } from "bun:test";
import { shouldProcess } from "../guard";

// SDK is mocked in setup.ts via __test.mockQuery
const mockQuery = (globalThis as any).__test.mockQuery;

describe("shouldProcess", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  test("Yでtrue", async () => {
    mockQuery.mockImplementation(async function* () {
      yield { result: "Y" };
    });
    expect(await shouldProcess("タスク登録して")).toBe(true);
  });

  test("Nでfalse", async () => {
    mockQuery.mockImplementation(async function* () {
      yield { result: "N" };
    });
    expect(await shouldProcess("天気いいね")).toBe(false);
  });

  test("小文字yでもtrue", async () => {
    mockQuery.mockImplementation(async function* () {
      yield { result: "y" };
    });
    expect(await shouldProcess("test")).toBe(true);
  });

  test("エラー時はtrue（通過）", async () => {
    mockQuery.mockImplementation(async function* () {
      throw new Error("fail");
    });
    expect(await shouldProcess("test")).toBe(true);
  });

  test("session_idを無視してresultのみ使う", async () => {
    mockQuery.mockImplementation(async function* () {
      yield { session_id: "s1" };
      yield { result: "N" };
    });
    expect(await shouldProcess("雑談")).toBe(false);
  });

  test("queryにmodel/maxTurns/allowedToolsが渡される", async () => {
    mockQuery.mockImplementation(async function* () {
      yield { result: "Y" };
    });
    await shouldProcess("test");
    const opts = mockQuery.mock.calls[0][0].options;
    expect(opts.model).toBe("claude-haiku-4-5-20251001");
    expect(opts.maxTurns).toBe(1);
    expect(opts.allowedTools).toEqual([]);
  });
});
