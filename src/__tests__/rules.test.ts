import { describe, test, expect, beforeEach, mock } from "bun:test";
import {
  loadRules,
  getRules,
  getChannelRule,
  getMessageRule,
  getReactionRule,
  getGuardConfig,
  isWatchedChannel,
} from "../rules";

// ../../rules is mocked in setup.ts with test data

describe("loadRules", () => {
  test("rules.tsからルールを読み込みzodバリデーションが通る", async () => {
    const rules = await loadRules();
    expect(rules.channels.C_TEST).toBeDefined();
    expect(rules.guard?.model).toBe("claude-haiku-4-5-20251001");
  });
});

describe("getRules", () => {
  beforeEach(async () => {
    await loadRules();
  });

  test("ロード済みのルールを返す", () => {
    expect(getRules().channels).toBeDefined();
  });
});

describe("getChannelRule", () => {
  beforeEach(async () => {
    await loadRules();
  });

  test("存在するチャンネル", () => {
    expect(getChannelRule("C_TEST")?.name).toBe("#test");
  });

  test("存在しないチャンネル", () => {
    expect(getChannelRule("X")).toBeUndefined();
  });
});

describe("getMessageRule", () => {
  beforeEach(async () => {
    await loadRules();
  });

  test("on_messageあり", () => {
    const r = getMessageRule("C_TEST");
    expect(r?.prompt).toBe("テスト処理");
    expect(r?.guard).toBe(false);
  });

  test("on_messageなし", () => {
    expect(getMessageRule("X")).toBeUndefined();
  });
});

describe("getReactionRule", () => {
  beforeEach(async () => {
    await loadRules();
  });

  test("リアクションあり", () => {
    expect(getReactionRule("C_TEST", "memo")?.prompt).toBe("タスク登録");
  });

  test("リアクションなし", () => {
    expect(getReactionRule("C_TEST", "thumbsup")).toBeUndefined();
  });

  test("チャンネルなし", () => {
    expect(getReactionRule("X", "memo")).toBeUndefined();
  });
});

describe("getGuardConfig", () => {
  test("ガード設定を返す", async () => {
    await loadRules();
    expect(getGuardConfig().model).toBe("claude-haiku-4-5-20251001");
  });
});

describe("isWatchedChannel", () => {
  beforeEach(async () => {
    await loadRules();
  });

  test("ルールありはtrue", () => {
    expect(isWatchedChannel("C_TEST")).toBe(true);
  });

  test("ルールなしはfalse", () => {
    expect(isWatchedChannel("X")).toBe(false);
  });
});

describe("zodバリデーションエラー", () => {
  test("不正なスキーマでprocess.exit(1)が呼ばれる", async () => {
    const exitMock = mock(() => {});
    const originalExit = process.exit;
    process.exit = exitMock as unknown as typeof process.exit;

    // Override the mock to return invalid data
    mock.module("../../rules", () => ({
      default: {
        channels: {
          C1: { on_message: { guard: "not-boolean" } }, // prompt missing, guard wrong type
        },
      },
    }));

    // Need to clear module cache for the re-mock to take effect
    // Since mock.module overrides globally, just call loadRules again
    await loadRules();

    expect(exitMock).toHaveBeenCalledWith(1);
    process.exit = originalExit;

    // Restore valid mock
    mock.module("../../rules", () => ({
      default: {
        guard: { model: "claude-haiku-4-5-20251001" },
        channels: {
          C_TEST: {
            name: "#test",
            on_message: { guard: false, prompt: "テスト処理" },
            on_reaction: {
              memo: { prompt: "タスク登録", guard: false },
              star: { prompt: "ブックマーク", guard: true },
            },
          },
        },
      },
    }));
  });
});
