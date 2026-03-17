import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

export const KNOWLEDGE_DIR =
  process.env.AIPM_KNOWLEDGE_DIR ||
  resolve(import.meta.dir, "..", "knowledge");

export async function saveDecision(
  question: string,
  answer: string,
  context?: string,
  tags?: string[],
): Promise<string> {
  await mkdir(KNOWLEDGE_DIR, { recursive: true });

  const id = Date.now().toString(36);
  const date = new Date().toISOString().split("T")[0];
  const filename = `${date}-${id}.md`;
  const filepath = join(KNOWLEDGE_DIR, filename);

  const tagLine = (tags || []).map((t) => `"${t}"`).join(", ");
  const content = [
    "---",
    `id: ${id}`,
    `date: ${date}`,
    `tags: [${tagLine}]`,
    "---",
    "",
    "## Question",
    question,
    "",
    "## Decision",
    answer,
    "",
    ...(context ? ["## Context", context, ""] : []),
  ].join("\n");

  await writeFile(filepath, content, "utf-8");
  console.log(`[knowledge] ADR saved: ${filename}`);
  return filepath;
}

export async function listDecisions(): Promise<string[]> {
  try {
    const files = await readdir(KNOWLEDGE_DIR);
    return files
      .filter((f) => f.endsWith(".md"))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

export async function readDecision(filename: string): Promise<string> {
  return readFile(join(KNOWLEDGE_DIR, filename), "utf-8");
}
