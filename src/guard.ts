import { query } from "@anthropic-ai/claude-agent-sdk";
import { resolve } from "node:path";
import { getGuardConfig } from "./rules";

const PROJECT_ROOT = resolve(import.meta.dir, "..");

const DEFAULT_PROMPT =
  "以下のSlackメッセージを見て、何らかのアクション（タスク登録・情報記録・回答など）が必要かを判断してください。" +
  "雑談・独り言・感情的なつぶやき・アクション不要な投稿は「N」、" +
  "仕事に関係する依頼・タスク・質問・報告・情報共有は「Y」と1文字だけ回答してください。";

/**
 * Haiku でメッセージを事前判定する（Claude Agent SDK 経由）。
 * maxTurns: 1、ツールなしで軽量に実行。
 */
export async function shouldProcess(message: string): Promise<boolean> {
  const { model, prompt } = getGuardConfig();

  try {
    let resultText = "";

    for await (const msg of query({
      prompt: `${prompt || DEFAULT_PROMPT}\n\nメッセージ: ${message}`,
      options: {
        model: model || "claude-haiku-4-5-20251001",
        cwd: PROJECT_ROOT,
        maxTurns: 1,
        allowedTools: [],
        permissionMode: "bypassPermissions",
        systemPrompt: "YまたはNの1文字だけで回答してください。",
      },
    })) {
      if ("result" in msg) {
        resultText = msg.result as string;
      }
    }

    const pass = resultText.trim().toUpperCase().startsWith("Y");
    if (!pass) {
      console.log(`[guard] スキップ: "${message.slice(0, 50)}..."`);
    }
    return pass;
  } catch (error) {
    console.error("[guard] Error:", error);
    return true;
  }
}
