import { mock } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// -- Env vars (before any module loads) --
process.env.SLACK_BOT_TOKEN = "xoxb-test";
process.env.SLACK_APP_TOKEN = "xapp-test";
process.env.SLACK_SIGNING_SECRET = "secret-test";
process.env.AIPM_KNOWLEDGE_DIR = mkdtempSync(
  join(tmpdir(), "aipm-test-"),
);

// -- Mock @slack/bolt --
const eventHandlers = new Map<string, Function>();
const actionHandlers = new Map<string, Function>();
const viewHandlers = new Map<string, Function>();
let messageHandler: Function | null = null;

mock.module("@slack/bolt", () => ({
  App: class MockApp {
    event(name: string, handler: Function) {
      eventHandlers.set(name, handler);
    }
    message(handler: Function) {
      messageHandler = handler;
    }
    action(pattern: RegExp | string, handler: Function) {
      actionHandlers.set(String(pattern), handler);
    }
    view(pattern: RegExp | string, handler: Function) {
      viewHandlers.set(String(pattern), handler);
    }
    async start() {}
  },
}));

// -- Mock Agent SDK (configurable per test via mockImplementation) --
const mockQueryFn = mock(async function* () {
  yield { result: "mock response" };
});
mock.module("@anthropic-ai/claude-agent-sdk", () => ({
  query: mockQueryFn,
}));

// -- Mock rules.ts dynamic import --
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

// Expose for test files
(globalThis as any).__test = {
  eventHandlers,
  actionHandlers,
  viewHandlers,
  getMessageHandler: () => messageHandler,
  mockQuery: mockQueryFn,
};
