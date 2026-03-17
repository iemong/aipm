import { describe, test, expect, beforeEach } from "bun:test";
import { askAgent, clearSession } from "../agent";

const mockQuery = (globalThis as any).__test.mockQuery;

describe("askAgent", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  test("結果を返す", async () => {
    mockQuery.mockImplementation(async function* () {
      yield { session_id: "s1" };
      yield { result: "完了" };
    });
    expect(await askAgent("test", "c1")).toBe("完了");
  });

  test("セッションIDを再利用する", async () => {
    mockQuery.mockImplementation(async function* () {
      yield { session_id: "s2" };
      yield { result: "1" };
    });
    await askAgent("1", "c-sess");

    mockQuery.mockImplementation(async function* () {
      yield { result: "2" };
    });
    await askAgent("2", "c-sess");

    expect(mockQuery.mock.calls[1][0].options.resume).toBe("s2");
  });

  test("別のcontextKeyは別セッション", async () => {
    mockQuery.mockImplementation(async function* () {
      yield { session_id: "sa" };
      yield { result: "A" };
    });
    await askAgent("A", "ca");

    mockQuery.mockImplementation(async function* () {
      yield { result: "B" };
    });
    await askAgent("B", "cb");

    expect(mockQuery.mock.calls[1][0].options.resume).toBeUndefined();
  });

  test("エラー時にメッセージを返す", async () => {
    mockQuery.mockImplementation(async function* () {
      throw new Error("fail");
    });
    expect(await askAgent("x", "c-err")).toContain("エラー");
  });

  test("allowedToolsにNotion/GitHub", async () => {
    mockQuery.mockImplementation(async function* () {
      yield { result: "ok" };
    });
    await askAgent("x", "c-tools");
    const tools = mockQuery.mock.calls[0][0].options.allowedTools;
    expect(tools).toContain("mcp__notion__*");
    expect(tools).toContain("mcp__github__*");
  });

  test("Edit/WriteはdisallowedTools", async () => {
    mockQuery.mockImplementation(async function* () {
      yield { result: "ok" };
    });
    await askAgent("x", "c-dis");
    const dis = mockQuery.mock.calls[0][0].options.disallowedTools;
    expect(dis).toContain("Edit");
    expect(dis).toContain("Write");
  });
});

describe("clearSession", () => {
  test("セッションをクリアする", async () => {
    mockQuery.mockImplementation(async function* () {
      yield { session_id: "sc" };
      yield { result: "ok" };
    });
    await askAgent("1", "c-clr");
    clearSession("c-clr");

    mockQuery.mockImplementation(async function* () {
      yield { result: "ok" };
    });
    await askAgent("2", "c-clr");
    expect(mockQuery.mock.calls[1][0].options.resume).toBeUndefined();
  });
});
