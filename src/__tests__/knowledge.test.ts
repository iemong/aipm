import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { saveDecision, listDecisions, readDecision } from "../knowledge";
import { getProjectsDir } from "../project";

describe("プロジェクト未登録チャンネル", () => {
  test("saveDecisionがエラーを投げる", async () => {
    expect(saveDecision("C_UNKNOWN", "Q", "A")).rejects.toThrow("プロジェクトが見つかりません");
  });
});

// --------------------------------------------------
// プロジェクトスコープ
// --------------------------------------------------

const projSlug = "_test-knowledge-proj";
const projChannelId = "C_KNOWLEDGE_PROJ";
const projectsDir = getProjectsDir();
const projDir = join(projectsDir, projSlug);

describe("project-scoped knowledge", () => {
  beforeAll(async () => {
    await mkdir(join(projDir, "knowledge"), { recursive: true });
    const config = `
import type { ProjectConfig } from "../../src/project";
const config = {
  name: "Knowledge Test",
  channelId: "${projChannelId}",
  createdAt: "2026-01-01T00:00:00.000Z",
} as const satisfies ProjectConfig;
export default config;
`;
    await writeFile(join(projDir, "project.ts"), config);
  });

  afterAll(async () => {
    await rm(projDir, { recursive: true, force: true });
  });

  test("ADRファイルをプロジェクトknowledgeディレクトリに作成する", async () => {
    const filepath = await saveDecision(projChannelId, "質問?", "回答", "背景");
    expect(filepath).toContain(`${projSlug}/knowledge/`);
    const content = await readFile(filepath, "utf-8");
    expect(content).toContain("## Question");
    expect(content).toContain("質問?");
    expect(content).toContain("## Decision");
    expect(content).toContain("回答");
    expect(content).toContain("## Context");
    expect(content).toContain("背景");
  });

  test("contextなし", async () => {
    const filepath = await saveDecision(projChannelId, "Q", "A");
    const content = await readFile(filepath, "utf-8");
    expect(content).not.toContain("## Context");
  });

  test("タグ付き", async () => {
    const filepath = await saveDecision(projChannelId, "Q", "A", undefined, ["t1", "t2"]);
    const content = await readFile(filepath, "utf-8");
    expect(content).toContain('"t1"');
    expect(content).toContain('"t2"');
  });

  test("listDecisionsがmdファイル一覧を降順で返す", async () => {
    const files = await listDecisions(projChannelId);
    expect(files.length).toBeGreaterThan(0);
    expect(files.every((f) => f.endsWith(".md"))).toBe(true);
    for (let i = 1; i < files.length; i++) {
      expect(files[i - 1] >= files[i]).toBe(true);
    }
  });

  test("readDecisionでファイル内容を読める", async () => {
    const files = await listDecisions(projChannelId);
    const content = await readDecision(projChannelId, files[0]);
    expect(content).toContain("Q");
  });
});
