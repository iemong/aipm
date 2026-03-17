import { describe, test, expect } from "bun:test";
import { readFile } from "node:fs/promises";
import { saveDecision, listDecisions, readDecision } from "../knowledge";

describe("saveDecision", () => {
  test("ADRファイルを作成する", async () => {
    const filepath = await saveDecision("質問?", "回答", "背景");
    expect(filepath).toMatch(/\.md$/);
    const content = await readFile(filepath, "utf-8");
    expect(content).toContain("## Question");
    expect(content).toContain("質問?");
    expect(content).toContain("## Decision");
    expect(content).toContain("回答");
    expect(content).toContain("## Context");
    expect(content).toContain("背景");
  });

  test("contextなし", async () => {
    const filepath = await saveDecision("Q", "A");
    const content = await readFile(filepath, "utf-8");
    expect(content).not.toContain("## Context");
  });

  test("タグ付き", async () => {
    const filepath = await saveDecision("Q", "A", undefined, ["t1", "t2"]);
    const content = await readFile(filepath, "utf-8");
    expect(content).toContain('"t1"');
    expect(content).toContain('"t2"');
  });
});

describe("listDecisions", () => {
  test("mdファイル一覧を降順で返す", async () => {
    await saveDecision("a", "b");
    const files = await listDecisions();
    expect(files.length).toBeGreaterThan(0);
    expect(files.every((f) => f.endsWith(".md"))).toBe(true);
    for (let i = 1; i < files.length; i++) {
      expect(files[i - 1] >= files[i]).toBe(true);
    }
  });
});

describe("readDecision", () => {
  test("ファイル内容を読める", async () => {
    await saveDecision("読み取り", "テスト");
    const files = await listDecisions();
    const content = await readDecision(files[0]);
    expect(content).toContain("読み取り");
  });
});
