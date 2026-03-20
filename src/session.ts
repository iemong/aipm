import { readFile, writeFile, readdir, unlink, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

const SESSIONS_DIR =
  process.env.MIMAMORI_SESSIONS_DIR || resolve(import.meta.dir, "..", "sessions");

const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24時間

function sessionPath(contextKey: string): string {
  const safe = contextKey.replace(/[^a-zA-Z0-9_-]/g, "_");
  return join(SESSIONS_DIR, `${safe}.json`);
}

export async function getSession(contextKey: string): Promise<string | null> {
  try {
    const raw = await readFile(sessionPath(contextKey), "utf-8");
    const data = JSON.parse(raw);
    if (Date.now() - data.updatedAt > MAX_AGE_MS) {
      return null;
    }
    return data.sessionId;
  } catch {
    return null;
  }
}

export async function saveSession(contextKey: string, sessionId: string): Promise<void> {
  await mkdir(SESSIONS_DIR, { recursive: true });
  await writeFile(
    sessionPath(contextKey),
    JSON.stringify({ sessionId, updatedAt: Date.now() }),
    "utf-8",
  );
}

export async function deleteSession(contextKey: string): Promise<void> {
  try {
    await unlink(sessionPath(contextKey));
  } catch {
    // ignore
  }
}

export async function cleanExpiredSessions(): Promise<number> {
  let cleaned = 0;
  try {
    const files = await readdir(SESSIONS_DIR);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = await readFile(join(SESSIONS_DIR, file), "utf-8");
        const data = JSON.parse(raw);
        if (Date.now() - data.updatedAt > MAX_AGE_MS) {
          await unlink(join(SESSIONS_DIR, file));
          cleaned++;
        }
      } catch {
        // skip invalid files
      }
    }
  } catch {
    // directory doesn't exist yet
  }
  if (cleaned > 0) {
    console.log(`[session] Cleaned ${cleaned} expired sessions`);
  }
  return cleaned;
}
