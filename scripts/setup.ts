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
  console.log("[Step 1/5] Slack");
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
  console.log("[Step 2/5] Notion");
  console.log("  Notion CLI を使って MCP サーバーを起動します。");
  console.log("  未インストールの場合: npm i -g ntn@latest");
  console.log("  認証: ntn auth login");
  console.log("");
  await ask("  上記を完了したら Enter を押してください: ");

  // ---- Step 3: GitHub ----
  console.log("");
  console.log("[Step 3/5] GitHub");
  console.log("  GitHub CLI を使って連携します。");
  console.log("  未インストールの場合: brew install gh");
  console.log("  認証: gh auth login");
  console.log("");
  await ask("  上記を完了したら Enter を押してください: ");

  // ---- Step 3: Sentry ----
  console.log("");
  console.log("[Step 4/5] Sentry");
  console.log("  Sentry CLI を使ってエラー監視と連携します。");
  console.log("  未インストールの場合: npm install -g sentry");
  console.log("  認証: sentry auth login");
  console.log("");
  await ask("  上記を完了したら Enter を押してください: ");

  // ---- Step 4: Persona ----
  console.log("");
  console.log("[Step 5/5] Persona");
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

  // ---- HITL Channel ----
  console.log("");
  console.log("[Bash Guard] HITL承認先");
  console.log("  ホワイトリスト外のBashコマンド実行時に承認を求める送信先です。");
  console.log("  チャンネルID (C...) またはユーザーID (U...) を指定できます。");
  console.log("  ユーザーIDを指定するとDMで承認リクエストが届きます。");
  console.log("  未指定の場合、ホワイトリスト外のコマンドは全て拒否されます。");
  const hitlChannel = await ask("  チャンネルID or ユーザーID (Enterでスキップ): ");

  // ---- Write .env ----
  const envLines = [
    "# Slack",
    `SLACK_BOT_TOKEN=${slackBotToken}`,
    `SLACK_APP_TOKEN=${slackAppToken}`,
    `SLACK_SIGNING_SECRET=${slackSigningSecret}`,
  ];
  if (hitlChannel) {
    envLines.push("", "# Bash Guard HITL", `SLACK_HITL_CHANNEL=${hitlChannel}`);
  }
  envLines.push("");
  const envContent = envLines.join("\n");

  await writeFile(resolve(ROOT, ".env"), envContent);
  console.log("  -> .env を作成しました");

  // ---- Write .mcp.json ----
  const mcpConfig = {
    mcpServers: {
      notion: {
        command: "ntn",
        args: ["mcp"],
      },
      aipm_bash: {
        command: "bun",
        args: ["run", "mcp-servers/bash-guard/index.ts"],
      },
    },
  };

  await writeFile(
    resolve(ROOT, ".mcp.json"),
    JSON.stringify(mcpConfig, null, 2) + "\n",
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
  console.log("  2. gh auth login (未実施の場合)");
  console.log("  3. ntn auth login (未実施の場合)");
  console.log("  4. sentry auth login (未実施の場合)");
  console.log("  5. bun run test:hitl  (HITL動作確認)");
  console.log("  6. bun run dev");
  console.log("");

  rl.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
