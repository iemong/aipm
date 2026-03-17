import { query } from "@anthropic-ai/claude-agent-sdk";
import { resolve } from "node:path";

const PROJECT_ROOT = resolve(import.meta.dir, "..");

const sessionMap = new Map<string, string>();

/**
 * Claude Agent SDKにプロンプトを送信し、結果を返す
 * contextKeyごとにセッションを維持し、会話を継続できる
 */
export async function askAgent(
  prompt: string,
  contextKey: string,
): Promise<string> {
  let resultText = "";

  try {
    const existingSession = sessionMap.get(contextKey);

    for await (const msg of query({
      prompt,
      options: {
        ...(existingSession ? { resume: existingSession } : {}),
        cwd: PROJECT_ROOT,
        settingSources: ["project", "user"],
        systemPrompt: { type: "preset", preset: "claude_code" },
        allowedTools: [
          "Read",
          "Glob",
          "Grep",
          "Bash",
          "mcp__notion__*",
          "mcp__github__*",
        ],
        disallowedTools: ["Edit", "Write"],
        permissionMode: "bypassPermissions",
        maxTurns: 15,
      },
    })) {
      if ("session_id" in msg) {
        sessionMap.set(contextKey, msg.session_id as string);
      }
      if ("result" in msg) {
        resultText = msg.result as string;
      }
    }
  } catch (error) {
    console.error("[agent] Query error:", error);
    resultText = "エラーが発生しました。もう一度お試しください。";
  }

  return resultText;
}

/**
 * セッションをクリアする
 */
export function clearSession(contextKey: string): void {
  sessionMap.delete(contextKey);
}
