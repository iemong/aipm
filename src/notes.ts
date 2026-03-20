import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { getProjectsDir } from "./project";

// --------------------------------------------------
// Paths & Template
// --------------------------------------------------

const TEMPLATE_PATH = resolve(import.meta.dir, "..", "templates", "notes.md");

function getNotesDir(projectSlug: string): string {
  return join(getProjectsDir(), projectSlug, "notes");
}

function getNotePath(projectSlug: string, date: string): string {
  return join(getNotesDir(projectSlug), `${date}.md`);
}

async function loadTemplate(): Promise<string> {
  return readFile(TEMPLATE_PATH, "utf-8");
}

// --------------------------------------------------
// Helpers
// --------------------------------------------------

function todayStr(): string {
  return new Date().toISOString().split("T")[0];
}

function formatTime(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function insertAfterSection(content: string, section: string, line: string): string | null {
  const header = `## ${section}`;
  const idx = content.indexOf(header);
  if (idx === -1) return null;
  const pos = idx + header.length;
  return content.slice(0, pos) + "\n" + line + content.slice(pos);
}

// --------------------------------------------------
// CRUD
// --------------------------------------------------

export async function getOrCreateDailyNote(projectSlug: string, date?: string): Promise<string> {
  const d = date ?? todayStr();
  const filepath = getNotePath(projectSlug, d);

  try {
    await readFile(filepath, "utf-8");
    return filepath;
  } catch {
    // ファイルが存在しない場合、テンプレートから作成
  }

  await mkdir(getNotesDir(projectSlug), { recursive: true });
  const template = await loadTemplate();
  await writeFile(filepath, template.replace("{{date}}", d), "utf-8");
  console.log(`[notes] Created: ${d}.md`);
  return filepath;
}

export async function appendTask(projectSlug: string, text: string): Promise<boolean> {
  const filepath = await getOrCreateDailyNote(projectSlug);
  const content = await readFile(filepath, "utf-8");
  const line = `- [ ] ${text} (${formatTime()})`;
  const updated = insertAfterSection(content, "Tasks", line);
  if (!updated) return false;
  await writeFile(filepath, updated, "utf-8");
  return true;
}

export async function appendMemo(projectSlug: string, text: string): Promise<boolean> {
  const filepath = await getOrCreateDailyNote(projectSlug);
  const content = await readFile(filepath, "utf-8");
  const line = `- ${text} (${formatTime()})`;
  const updated = insertAfterSection(content, "Memo", line);
  if (!updated) return false;
  await writeFile(filepath, updated, "utf-8");
  return true;
}

function findAndCompleteTask(
  content: string,
  query: string,
): { updated: string; matched: string } | null {
  const lines = content.split("\n");
  const lowerQuery = query.toLowerCase();
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("- [ ] ") && lines[i].toLowerCase().includes(lowerQuery)) {
      const matched = lines[i];
      lines[i] = lines[i].replace("- [ ] ", "- [x] ");
      return { updated: lines.join("\n"), matched };
    }
  }
  return null;
}

export async function completeTask(
  projectSlug: string,
  query: string,
): Promise<{ ok: boolean; matched?: string }> {
  const filepath = getNotePath(projectSlug, todayStr());
  try {
    const content = await readFile(filepath, "utf-8");
    const result = findAndCompleteTask(content, query);
    if (!result) return { ok: false };
    await writeFile(filepath, result.updated, "utf-8");
    return { ok: true, matched: result.matched };
  } catch {
    return { ok: false };
  }
}

export async function listPendingTasks(projectSlug: string, date?: string): Promise<string[]> {
  const filepath = getNotePath(projectSlug, date ?? todayStr());
  try {
    const content = await readFile(filepath, "utf-8");
    return content.split("\n").filter((line) => line.startsWith("- [ ] "));
  } catch {
    return [];
  }
}
