import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { requireEnv, config } from "../config";

describe("requireEnv", () => {
  const original = process.env.TEST_VAR;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.TEST_VAR;
    } else {
      process.env.TEST_VAR = original;
    }
  });

  test("設定済みの環境変数を返す", () => {
    process.env.TEST_VAR = "hello";
    expect(requireEnv("TEST_VAR")).toBe("hello");
  });

  test("未設定の環境変数でエラーを投げる", () => {
    delete process.env.TEST_VAR;
    expect(() => requireEnv("TEST_VAR")).toThrow(
      "環境変数 TEST_VAR が設定されていません",
    );
  });

  test("空文字の環境変数でエラーを投げる", () => {
    process.env.TEST_VAR = "";
    expect(() => requireEnv("TEST_VAR")).toThrow(
      "環境変数 TEST_VAR が設定されていません",
    );
  });
});

describe("config", () => {
  const saved = {
    SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN,
    SLACK_APP_TOKEN: process.env.SLACK_APP_TOKEN,
    SLACK_SIGNING_SECRET: process.env.SLACK_SIGNING_SECRET,
  };

  beforeEach(() => {
    process.env.SLACK_BOT_TOKEN = "xoxb-test";
    process.env.SLACK_APP_TOKEN = "xapp-test";
    process.env.SLACK_SIGNING_SECRET = "secret-test";
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  test("slackBotToken を返す", () => {
    expect(config.slackBotToken).toBe("xoxb-test");
  });

  test("slackAppToken を返す", () => {
    expect(config.slackAppToken).toBe("xapp-test");
  });

  test("slackSigningSecret を返す", () => {
    expect(config.slackSigningSecret).toBe("secret-test");
  });

  test("未設定時にエラーを投げる", () => {
    delete process.env.SLACK_BOT_TOKEN;
    expect(() => config.slackBotToken).toThrow();
  });
});
