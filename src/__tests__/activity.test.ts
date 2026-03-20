import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, rm, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  createActivity,
  getActivity,
  appendToActivity,
  updateActivityStatus,
  listActivities,
} from "../activity";
import { getProjectsDir } from "../project";

const TEST_SLUG = "_test-activity";
const projectDir = join(getProjectsDir(), TEST_SLUG);
const activityDir = join(projectDir, "activity");

beforeAll(async () => {
  await mkdir(join(projectDir, "knowledge"), { recursive: true });

  const configContent = `
import type { ProjectConfig } from "../../src/project";
const config: ProjectConfig = {
  name: "test-activity",
  channelId: "C_ACTIVITY_TEST",
  createdAt: "2026-01-01T00:00:00.000Z",
};
export default config;
`;
  const { writeFile } = await import("node:fs/promises");
  await writeFile(join(projectDir, "project.ts"), configContent);
});

afterAll(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe("createActivity", () => {
  test("テンプレートからactivityファイルを作成する", async () => {
    const activity = await createActivity(TEST_SLUG, {
      trigger: "Sentry: AuthError",
      tags: ["sentry", "auth"],
    });

    expect(activity.meta.status).toBe("investigating");
    expect(activity.meta.trigger).toBe("Sentry: AuthError");
    expect(activity.meta.tags).toEqual(["sentry", "auth"]);

    const files = await readdir(activityDir);
    expect(files.length).toBe(1);
    expect(files[0]).toContain("sentry");

    const content = await readFile(join(activityDir, files[0]), "utf-8");
    expect(content).toContain("## 事実ログ");
    expect(content).toContain("## 進捗");
    expect(content).toContain("## 成果");
  });

  test("slack_permalinkを保存する", async () => {
    const activity = await createActivity(TEST_SLUG, {
      trigger: "Test with permalink",
      slack_permalink: "https://slack.com/archives/C123/p456",
    });
    expect(activity.meta.slack_permalink).toBe("https://slack.com/archives/C123/p456");
  });
});

describe("getActivity", () => {
  test("ファイル名で取得できる", async () => {
    const files = await readdir(activityDir);
    const activity = await getActivity(TEST_SLUG, files[0]);
    expect(activity).not.toBeNull();
    expect(activity!.meta.trigger).toBe("Sentry: AuthError");
  });

  test("存在しないファイルはnull", async () => {
    const result = await getActivity(TEST_SLUG, "nonexistent.md");
    expect(result).toBeNull();
  });
});

describe("appendToActivity", () => {
  test("事実ログセクションに追記できる", async () => {
    const files = await readdir(activityDir);
    const ok = await appendToActivity(
      TEST_SLUG,
      files[0],
      "事実ログ",
      "- 2026-03-20 14:00 — エラー検知",
    );
    expect(ok).toBe(true);

    const content = await readFile(join(activityDir, files[0]), "utf-8");
    expect(content).toContain("- 2026-03-20 14:00 — エラー検知");
  });

  test("進捗セクションに追記できる", async () => {
    const files = await readdir(activityDir);
    const ok = await appendToActivity(TEST_SLUG, files[0], "進捗", "- [ ] 原因調査");
    expect(ok).toBe(true);

    const content = await readFile(join(activityDir, files[0]), "utf-8");
    expect(content).toContain("- [ ] 原因調査");
  });

  test("成果セクションに追記できる", async () => {
    const files = await readdir(activityDir);
    const ok = await appendToActivity(TEST_SLUG, files[0], "成果", "- 根本原因を特定");
    expect(ok).toBe(true);

    const content = await readFile(join(activityDir, files[0]), "utf-8");
    expect(content).toContain("- 根本原因を特定");
  });
});

describe("updateActivityStatus", () => {
  test("ステータスを更新できる", async () => {
    const files = await readdir(activityDir);
    const ok = await updateActivityStatus(TEST_SLUG, files[0], "resolved");
    expect(ok).toBe(true);

    const activity = await getActivity(TEST_SLUG, files[0]);
    expect(activity!.meta.status).toBe("resolved");
  });
});

describe("listActivities", () => {
  test("全activityを取得できる", async () => {
    const list = await listActivities(TEST_SLUG);
    expect(list.length).toBeGreaterThanOrEqual(2);
  });

  test("ステータスでフィルタできる", async () => {
    const resolved = await listActivities(TEST_SLUG, {
      status: "resolved",
    });
    expect(resolved.length).toBeGreaterThanOrEqual(1);
    expect(resolved.every((a) => a.meta.status === "resolved")).toBe(true);

    const investigating = await listActivities(TEST_SLUG, {
      status: "investigating",
    });
    expect(investigating.every((a) => a.meta.status === "investigating")).toBe(true);
  });

  test("存在しないプロジェクトは空配列", async () => {
    const list = await listActivities("nonexistent-project");
    expect(list).toEqual([]);
  });
});
