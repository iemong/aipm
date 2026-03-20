import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { findProjectByChannel, getProjectsDir } from "./project";

export interface GuardLogEntry {
  ts: string;
  channelId?: string;
  decision: "Y" | "N";
  message: string;
}

async function writeLogEntry(
  channelId: string,
  decision: "Y" | "N",
  message: string,
): Promise<void> {
  const project = await findProjectByChannel(channelId);
  if (!project) return;

  const logsDir = join(getProjectsDir(), project.slug, "guard-logs");
  await mkdir(logsDir, { recursive: true });

  const now = new Date();
  const filepath = join(logsDir, `${now.toISOString().split("T")[0]}.jsonl`);
  const entry: GuardLogEntry = {
    ts: now.toISOString(),
    channelId,
    decision,
    message: message.slice(0, 200),
  };
  await appendFile(filepath, JSON.stringify(entry) + "\n", "utf-8");
}

export async function logGuardDecision(
  decision: "Y" | "N",
  message: string,
  channelId?: string,
): Promise<void> {
  try {
    if (channelId) await writeLogEntry(channelId, decision, message);
  } catch (error) {
    console.error("[guard-log] Write error:", error);
  }
}
