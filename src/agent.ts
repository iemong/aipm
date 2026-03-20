import { query } from "@anthropic-ai/claude-agent-sdk";
import { resolve } from "node:path";
import { getSession, saveSession, deleteSession } from "./session";

const PROJECT_ROOT = resolve(import.meta.dir, "..");

/**
 * Claude Agent SDKにプロンプトを送信し、結果を返す
 * contextKeyごとにセッションを維持し、会話を継続できる
 */
async function runQuery(prompt: string, contextKey: string): Promise<string> {
  const existingSession = await getSession(contextKey);
  let resultText = "";

  for await (const msg of query({
    prompt,
    options: {
      ...(existingSession ? { resume: existingSession } : {}),
      cwd: PROJECT_ROOT,
      settingSources: ["project", "user"],
      systemPrompt: { type: "preset", preset: "claude_code" },
      allowedTools: ["Read", "Glob", "Grep", "mcp__github__*", "mcp__mimamori_bash__*"],
      disallowedTools: ["Edit", "Write", "Bash"],
      permissionMode: "bypassPermissions",
      maxTurns: 15,
    },
  })) {
    if ("session_id" in msg) await saveSession(contextKey, msg.session_id as string);
    if ("result" in msg) resultText = msg.result as string;
  }
  return resultText;
}

export async function askAgent(prompt: string, contextKey: string): Promise<string> {
  try {
    return await runQuery(prompt, contextKey);
  } catch (error) {
    console.error("[agent] Query error:", error);
    return "エラーが発生しました。もう一度お試しください。";
  }
}

/**
 * セッションをクリアする
 */
export async function clearSession(contextKey: string): Promise<void> {
  await deleteSession(contextKey);
}
