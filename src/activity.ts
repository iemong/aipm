import { z } from "zod";
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { getProjectsDir } from "./project";

// --------------------------------------------------
// Schema
// --------------------------------------------------

export const activityStatusSchema = z.enum(["investigating", "resolved", "stale"]);
export type ActivityStatus = z.infer<typeof activityStatusSchema>;

export const activitySchema = z.object({
  id: z.string(),
  date: z.string(),
  status: activityStatusSchema,
  trigger: z.string(),
  slack_permalink: z.string().optional(),
  tags: z.array(z.string()).default([]),
});

export type ActivityMeta = z.infer<typeof activitySchema>;

export interface Activity {
  meta: ActivityMeta;
  body: string;
}

// --------------------------------------------------
// Template
// --------------------------------------------------

const TEMPLATE_PATH = resolve(import.meta.dir, "..", "templates", "activity.md");

async function loadTemplate(): Promise<string> {
  return readFile(TEMPLATE_PATH, "utf-8");
}

// --------------------------------------------------
// Paths
// --------------------------------------------------

function getActivityDir(projectSlug: string): string {
  return join(getProjectsDir(), projectSlug, "activity");
}

// --------------------------------------------------
// Parse / Serialize
// --------------------------------------------------

function parseFrontmatter(content: string): {
  attrs: Record<string, string>;
  body: string;
} {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)/);
  if (!match) return { attrs: {}, body: content };

  const attrs: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    attrs[key] = val;
  }
  return { attrs, body: match[2] };
}

function parseTags(raw: string): string[] {
  const match = raw.match(/\[(.*)\]/);
  if (!match) return [];
  return match[1]
    .split(",")
    .map((s) => s.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
}

function parseActivity(content: string): Activity {
  const { attrs, body } = parseFrontmatter(content);
  const meta = activitySchema.parse({
    id: attrs.id,
    date: attrs.date,
    status: attrs.status || "investigating",
    trigger: (attrs.trigger || "").replace(/^"|"$/g, ""),
    slack_permalink: (attrs.slack_permalink || "").replace(/^"|"$/g, "") || undefined,
    tags: attrs.tags ? parseTags(attrs.tags) : [],
  });
  return { meta, body };
}

function serializeMeta(meta: ActivityMeta): string {
  const lines = [
    "---",
    `id: ${meta.id}`,
    `date: ${meta.date}`,
    `status: ${meta.status}`,
    `trigger: "${meta.trigger}"`,
  ];
  if (meta.slack_permalink) {
    lines.push(`slack_permalink: "${meta.slack_permalink}"`);
  }
  if (meta.tags.length > 0) {
    lines.push(`tags: [${meta.tags.map((t) => `"${t}"`).join(", ")}]`);
  }
  lines.push("---");
  return lines.join("\n");
}

// --------------------------------------------------
// CRUD
// --------------------------------------------------

function buildActivityMeta(input: { trigger: string; slack_permalink?: string; tags?: string[] }): {
  meta: ActivityMeta;
  id: string;
  date: string;
} {
  const id = Date.now().toString(36);
  const date = new Date().toISOString().split("T")[0];
  const meta: ActivityMeta = {
    id,
    date,
    status: "investigating",
    trigger: input.trigger,
    slack_permalink: input.slack_permalink,
    tags: input.tags || [],
  };
  return { meta, id, date };
}

function buildActivityFilename(trigger: string, id: string, date: string): string {
  const slug = trigger
    .slice(0, 50)
    .toLowerCase()
    .replace(/[^a-z0-9\u3000-\u9fff]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${date}-${slug || id}.md`;
}

export async function createActivity(
  projectSlug: string,
  input: {
    trigger: string;
    slack_permalink?: string;
    tags?: string[];
  },
): Promise<Activity> {
  const dir = getActivityDir(projectSlug);
  await mkdir(dir, { recursive: true });

  const template = await loadTemplate();
  const { meta, id, date } = buildActivityMeta(input);
  const { body } = parseFrontmatter(template.replace("{{id}}", id).replace("{{date}}", date));
  const filename = buildActivityFilename(input.trigger, id, date);

  await writeFile(join(dir, filename), serializeMeta(meta) + "\n" + body, "utf-8");
  console.log(`[activity] Created: ${filename}`);
  return { meta, body };
}

export async function getActivity(projectSlug: string, filename: string): Promise<Activity | null> {
  try {
    const content = await readFile(join(getActivityDir(projectSlug), filename), "utf-8");
    return parseActivity(content);
  } catch {
    return null;
  }
}

function insertAfterSection(content: string, section: string, line: string): string | null {
  const sectionHeader = `## ${section}`;
  const idx = content.indexOf(sectionHeader);
  if (idx === -1) return null;
  const insertPos = idx + sectionHeader.length;
  return content.slice(0, insertPos) + "\n" + line + content.slice(insertPos);
}

// oxlint-disable-next-line max-params -- 既存公開APIを維持
export async function appendToActivity(
  projectSlug: string,
  filename: string,
  section: "事実ログ" | "進捗" | "成果",
  line: string,
): Promise<boolean> {
  const filepath = join(getActivityDir(projectSlug), filename);
  try {
    const content = await readFile(filepath, "utf-8");
    const updated = insertAfterSection(content, section, line);
    if (!updated) return false;
    await writeFile(filepath, updated, "utf-8");
    return true;
  } catch {
    return false;
  }
}

export async function updateActivityStatus(
  projectSlug: string,
  filename: string,
  status: ActivityStatus,
): Promise<boolean> {
  const filepath = join(getActivityDir(projectSlug), filename);
  try {
    const content = await readFile(filepath, "utf-8");
    const updated = content.replace(/^status: \w+$/m, `status: ${status}`);
    await writeFile(filepath, updated, "utf-8");
    console.log(`[activity] ${filename} → ${status}`);
    return true;
  } catch {
    return false;
  }
}

export async function appendHandoffPrompt(
  projectSlug: string,
  filename: string,
  handoffMarkdown: string,
): Promise<boolean> {
  const block = `\n### ハンドオフプロンプト\n\n\`\`\`markdown\n${handoffMarkdown}\n\`\`\`\n`;
  return appendToActivity(projectSlug, filename, "成果", block);
}

async function readActivityMeta(
  dir: string,
  file: string,
): Promise<{ filename: string; meta: ActivityMeta } | null> {
  if (!file.endsWith(".md")) return null;
  try {
    const content = await readFile(join(dir, file), "utf-8");
    return { filename: file, meta: parseActivity(content).meta };
  } catch {
    return null;
  }
}

export async function listActivities(
  projectSlug: string,
  filter?: { status?: ActivityStatus },
): Promise<{ filename: string; meta: ActivityMeta }[]> {
  const dir = getActivityDir(projectSlug);
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }

  const entries = await Promise.all(files.map((f) => readActivityMeta(dir, f)));
  return entries
    .filter(
      (e): e is NonNullable<typeof e> =>
        !!e && (!filter?.status || e.meta.status === filter.status),
    )
    .sort((a, b) => b.meta.date.localeCompare(a.meta.date));
}
