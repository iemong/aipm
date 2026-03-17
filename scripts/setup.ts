import { createInterface } from "node:readline/promises";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");

const rl = createInterface({ input: process.stdin, output: process.stdout });

async function ask(prompt: string, fallback = ""): Promise<string> {
  const answer = await rl.question(prompt);
  return answer.trim() || fallback;
}

async function main() {
  console.log("");
  console.log("=================================");
  console.log("  AIPM Setup Wizard");
  console.log("=================================");
  console.log("");

  // ---- Step 1: Slack ----
  console.log("[Step 1/4] Slack");
  console.log("  Slack App を Socket Mode で作成し、以下のスコープを付与してください:");
  console.log("  Bot scopes: app_mentions:read, channels:history, channels:read,");
  console.log("              chat:write, reactions:read, users:read");
  console.log("  Event subscriptions: app_mention, message.channels, reaction_added");
  console.log("");
  const slackBotToken = await ask("  Bot Token (xoxb-...): ");
  const slackAppToken = await ask("  App-Level Token (xapp-...): ");
  const slackSigningSecret = await ask("  Signing Secret: ");

  // ---- Step 2: Notion ----
  console.log("");
  console.log("[Step 2/4] Notion");
  console.log(
    "  https://www.notion.so/my-integrations で Internal Integration を作成してください。",
  );
  console.log("");
  const notionApiKey = await ask("  Notion API Key: ");

  // ---- Step 3: GitHub ----
  console.log("");
  console.log("[Step 3/4] GitHub");
  const githubToken = await ask(
    "  GitHub Token (空欄で gh CLI 認証を使用): ",
  );

  // ---- Step 4: Persona ----
  console.log("");
  console.log("[Step 4/4] Persona");
  const personaName = await ask("  名前 (default: AI PM): ", "AI PM");
  const personaRole = await ask(
    "  役割 (default: パーソナルプロジェクトマネージャー): ",
    "パーソナルプロジェクトマネージャー",
  );
  const personaTone = await ask(
    "  口調 (例: 丁寧語, カジュアル, けだるめ) (default: 丁寧語ベース): ",
    "丁寧語ベース",
  );
  const personaTraits = await ask(
    "  性格 (カンマ区切り) (default: 冷静,的確,簡潔): ",
    "冷静,的確,簡潔",
  );
  const personaEmoji = await ask(
    "  絵文字の使用 (積極的/控えめ/なし) (default: 控えめ): ",
    "控えめ",
  );

  // ---- Write .env ----
  const envContent = [
    "# Slack",
    `SLACK_BOT_TOKEN=${slackBotToken}`,
    `SLACK_APP_TOKEN=${slackAppToken}`,
    `SLACK_SIGNING_SECRET=${slackSigningSecret}`,
    "",
    "# Notion",
    `NOTION_API_KEY=${notionApiKey}`,
    "",
    "# GitHub",
    `GITHUB_TOKEN=${githubToken}`,
    "",
  ].join("\n");

  await writeFile(resolve(ROOT, ".env"), envContent);
  console.log("  -> .env を作成しました");

  // ---- Write .mcp.json ----
  const mcpServers: Record<string, unknown> = {};

  if (notionApiKey) {
    mcpServers.notion = {
      command: "bunx",
      args: ["@notionhq/notion-mcp-server"],
      env: {
        OPENAPI_MCP_HEADERS: JSON.stringify({
          Authorization: `Bearer ${notionApiKey}`,
          "Notion-Version": "2022-06-28",
        }),
      },
    };
  }

  if (githubToken) {
    mcpServers.github = {
      command: "bunx",
      args: ["@modelcontextprotocol/server-github"],
      env: {
        GITHUB_PERSONAL_ACCESS_TOKEN: githubToken,
      },
    };
  }

  await writeFile(
    resolve(ROOT, ".mcp.json"),
    JSON.stringify({ mcpServers }, null, 2) + "\n",
  );
  console.log("  -> .mcp.json を作成しました");

  // ---- Check rules.ts exists ----
  try {
    await readFile(resolve(ROOT, "rules.ts"), "utf-8");
    console.log("  -> rules.ts は既存のため変更しません");
  } catch {
    const rulesTs = `import type { Rules } from "./src/rules";

const rules = {
  guard: {
    model: "claude-haiku-4-5-20251001",
  },

  channels: {
    // チャンネルIDをキーにしてルールを定義
    // "C01234567": {
    //   name: "#tasks",
    //   on_message: {
    //     guard: true,
    //     prompt: "投稿を分析し、必要に応じてNotionにタスク登録してください。",
    //   },
    //   on_reaction: {
    //     memo: { prompt: "Notionにタスクとして登録してください。" },
    //   },
    // },
  },
} as const satisfies Rules;

export default rules;
`;
    await writeFile(resolve(ROOT, "rules.ts"), rulesTs);
    console.log("  -> rules.ts を作成しました（チャンネルルールを追加してください）");
  }

  // ---- Write persona.md ----
  const traits = personaTraits
    .split(",")
    .map((t) => `- ${t.trim()}`)
    .join("\n");

  const emojiGuide =
    personaEmoji === "積極的"
      ? "積極的に使用"
      : personaEmoji === "なし"
        ? "使用しない"
        : "控えめに使用";

  const personaContent = [
    "# Persona",
    "",
    "## Name",
    personaName,
    "",
    "## Role",
    personaRole,
    "",
    "## Personality",
    traits,
    "",
    "## Speaking Style",
    `- **Tone**: ${personaTone}`,
    "- **Length**: 簡潔（1-3文で回答）",
    `- **Emoji**: ${emojiGuide}`,
    "",
    "## Communication Rules",
    "- 事実ベースで伝える",
    "- 感情的にならない",
    "- 必要以上に褒めない（褒める時は具体的に）",
    "- リマインドは責めずにフラットに",
    "",
    "## Decision Priorities",
    "1. 持続可能か",
    "2. 今の状態で回るか",
    "3. 本当に必要か",
    "4. 今やる意味があるか",
    "5. 後で困るか",
    "",
    "## Example Responses",
    '- タスク完了: "完了しました。次は〇〇が残っています。"',
    '- リマインド: "14:30です。予定では開発タスクの時間ですが、着手しますか？"',
    '- 褒め: "今日は3つ完了。悪くないペースです。"',
    '- 切り捨て: "それは今週捨てていいです。"',
    "",
  ].join("\n");

  await writeFile(resolve(ROOT, "persona.md"), personaContent);
  console.log("  -> persona.md を更新しました");

  // ---- Remove SETUP_REQUIRED marker from CLAUDE.md ----
  try {
    const claudeMd = await readFile(resolve(ROOT, "CLAUDE.md"), "utf-8");
    const updated = claudeMd
      .replace("<!-- SETUP_REQUIRED -->\n", "")
      .replace(
        "<!-- このマーカーが存在する場合、初回セットアップが必要です。bun run setup を実行してください。 -->\n",
        "",
      );
    await writeFile(resolve(ROOT, "CLAUDE.md"), updated);
    console.log("  -> CLAUDE.md の SETUP_REQUIRED マーカーを削除しました");
  } catch {
    // pass
  }

  console.log("");
  console.log("=================================");
  console.log("  Setup complete!");
  console.log("=================================");
  console.log("");
  console.log("  次のステップ:");
  console.log("  1. rules.ts にチャンネルルールを追加");
  console.log("  2. bun run dev");
  console.log("");

  rl.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
