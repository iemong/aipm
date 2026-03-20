import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { findProjectByChannel, getProjectKnowledgeDir } from "./project";

async function resolveKnowledgeDir(channelId: string): Promise<string> {
  const project = await findProjectByChannel(channelId);
  if (!project) {
    throw new Error(
      `チャンネル ${channelId} に紐づくプロジェクトが見つかりません。bun run project:create で作成してください。`,
    );
  }
  return getProjectKnowledgeDir(project.slug);
}

export async function saveDecision(
  channelId: string,
  question: string,
  answer: string,
  context?: string,
  tags?: string[],
): Promise<string> {
  const channelDir = await resolveKnowledgeDir(channelId);
  await mkdir(channelDir, { recursive: true });

  const id = Date.now().toString(36);
  const date = new Date().toISOString().split("T")[0];
  const filename = `${date}-${id}.md`;
  const filepath = join(channelDir, filename);

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

export async function listDecisions(channelId: string): Promise<string[]> {
  try {
    const channelDir = await resolveKnowledgeDir(channelId);
    const files = await readdir(channelDir);
    return files
      .filter((f) => f.endsWith(".md"))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

export async function readDecision(channelId: string, filename: string): Promise<string> {
  const channelDir = await resolveKnowledgeDir(channelId);
  return readFile(join(channelDir, filename), "utf-8");
}
