import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, rm, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseHandoffFromResult } from "../handoff";
import { createActivity, appendHandoffPrompt } from "../activity";
import { getProjectsDir } from "../project";

// --------------------------------------------------
// parseHandoffFromResult
// --------------------------------------------------

describe("parseHandoffFromResult", () => {
  test("マーカーがない場合はnullを返す", () => {
    const { handoff, cleanText } = parseHandoffFromResult("通常の応答です。");
    expect(handoff).toBeNull();
    expect(cleanText).toBe("通常の応答です。");
  });

  test("マーカーをパースして生Markdownを抽出する", () => {
    const md = `# タスク: バグ修正\n\n## 背景\nエラーが発生している`;
    const text = `調査結果です。\n:::HANDOFF:::\n${md}\n:::END_HANDOFF:::`;
    const { handoff, cleanText } = parseHandoffFromResult(text);
    expect(handoff).toBe(md);
    expect(cleanText).toBe("調査結果です。");
  });

  test("複数行のMarkdownを正しく抽出する", () => {
    const md = [
      "# タスク: パフォーマンス改善",
      "",
      "## 背景",
      "レスポンスタイムが遅い",
      "",
      "## 対象ファイル",
      "- `src/api/handler.ts` (L42-58) — N+1クエリ",
      "",
      "## 実施内容",
      "1. クエリをバッチ化する",
      "2. インデックスを追加する",
      "",
      "## 検証方法",
      "- `bun test` が通ること",
    ].join("\n");
    const text = `以下の修正が必要です。\n\n:::HANDOFF:::\n${md}\n:::END_HANDOFF:::\n\n以上です。`;
    const { handoff, cleanText } = parseHandoffFromResult(text);
    expect(handoff).toBe(md);
    expect(cleanText).toBe("以下の修正が必要です。\n\n\n\n以上です。");
  });

  test("マーカーのみの場合cleanTextは空文字", () => {
    const md = "# タスク: 修正";
    const text = `:::HANDOFF:::\n${md}\n:::END_HANDOFF:::`;
    const { handoff, cleanText } = parseHandoffFromResult(text);
    expect(handoff).toBe(md);
    expect(cleanText).toBe("");
  });

  test("空のマーカーはnullを返す", () => {
    const text = ":::HANDOFF:::\n\n:::END_HANDOFF:::";
    const { handoff, cleanText } = parseHandoffFromResult(text);
    expect(handoff).toBeNull();
    expect(cleanText).toBe(text);
  });

  test("HITLマーカーとハンドオフマーカーの共存", () => {
    const md = "# タスク: 修正";
    const text = `応答\n:::HANDOFF:::\n${md}\n:::END_HANDOFF:::\n:::HITL:::\n{"question":"Q","type":"confirm"}\n:::END_HITL:::`;
    const { handoff, cleanText } = parseHandoffFromResult(text);
    expect(handoff).toBe(md);
    // HITLマーカーはcleanTextに残る
    expect(cleanText).toContain(":::HITL:::");
  });
});

// --------------------------------------------------
// appendHandoffPrompt
// --------------------------------------------------

const TEST_SLUG = "_test-handoff";
const projectDir = join(getProjectsDir(), TEST_SLUG);
const activityDir = join(projectDir, "activity");

beforeAll(async () => {
  await mkdir(join(projectDir, "knowledge"), { recursive: true });

  const configContent = `
import type { ProjectConfig } from "../../src/project";
const config: ProjectConfig = {
  name: "test-handoff",
  channelId: "C_HANDOFF_TEST",
  createdAt: "2026-01-01T00:00:00.000Z",
};
export default config;
`;
  await writeFile(join(projectDir, "project.ts"), configContent);
});

afterAll(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe("appendHandoffPrompt", () => {
  test("成果セクションにfenced markdownブロックを追記する", async () => {
    await createActivity(TEST_SLUG, {
      trigger: "Handoff test",
    });

    const files = await readdir(activityDir);
    const filename = files[0];

    const handoffMd = "# タスク: テスト修正\n\n## 背景\nテストが失敗している";
    const ok = await appendHandoffPrompt(TEST_SLUG, filename, handoffMd);
    expect(ok).toBe(true);

    const content = await readFile(join(activityDir, filename), "utf-8");
    expect(content).toContain("### ハンドオフプロンプト");
    expect(content).toContain("```markdown");
    expect(content).toContain(handoffMd);
    expect(content).toContain("```");
  });

  test("存在しないファイルにはfalseを返す", async () => {
    const ok = await appendHandoffPrompt(TEST_SLUG, "nonexistent.md", "# test");
    expect(ok).toBe(false);
  });
});
