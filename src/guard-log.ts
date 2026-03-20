import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { findProjectByChannel, getProjectsDir } from "./project";

export interface GuardLogEntry {
  ts: string;
  channelId?: string;
  decision: "Y" | "N";
  message: string;
}

export async function logGuardDecision(
  decision: "Y" | "N",
  message: string,
  channelId?: string,
): Promise<void> {
  try {
    if (!channelId) return;

    const project = await findProjectByChannel(channelId);
    if (!project) return;

    const logsDir = join(getProjectsDir(), project.slug, "guard-logs");
    await mkdir(logsDir, { recursive: true });

    const date = new Date().toISOString().split("T")[0];
    const filepath = join(logsDir, `${date}.jsonl`);

    const entry: GuardLogEntry = {
      ts: new Date().toISOString(),
      channelId,
      decision,
      message: message.slice(0, 200),
    };

    await appendFile(filepath, JSON.stringify(entry) + "\n", "utf-8");
  } catch (error) {
    console.error("[guard-log] Write error:", error);
  }
}
