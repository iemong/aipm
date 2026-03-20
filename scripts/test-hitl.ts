import { createInterface } from "node:readline/promises";
import { App, type BlockAction, type ViewSubmitAction } from "@slack/bolt";
import { config } from "../src/config";
import {
  buildHitlBlocks,
  buildFreeformModal,
  waitForHitl,
  resolvePendingHitl,
  type HitlRequest,
} from "../src/hitl";

const rl = createInterface({ input: process.stdin, output: process.stdout });

async function ask(prompt: string, fallback = ""): Promise<string> {
  const answer = await rl.question(prompt);
  return answer.trim() || fallback;
}

// --------------------------------------------------
// テストケース定義
// --------------------------------------------------

const testCases: { name: string; hitl: HitlRequest }[] = [
  {
    name: "confirm (はい/いいえ)",
    hitl: {
      question: "HITL confirm テスト: はい/いいえを押してください",
      type: "confirm",
      context: "テストスクリプトからの確認テストです",
    },
  },
  {
    name: "choice (選択肢)",
    hitl: {
      question: "HITL choice テスト: 好きな色を選んでください",
      type: "choice",
      options: ["赤", "青", "緑"],
    },
  },
  {
    name: "freeform (自由回答)",
    hitl: {
      question: "HITL freeform テスト: 「自由回答」ボタンを押してモーダルに何か入力してください",
      type: "freeform",
      context: "モーダル入力のテストです",
    },
  },
];

// --------------------------------------------------
// メイン
// --------------------------------------------------

async function main() {
  console.log("");
  console.log("=================================");
  console.log("  Mimamori HITL テスト");
  console.log("=================================");
  console.log("");
  console.log("  Slack上でHITLボタン→回答のラウンドトリップを検証します。");
  console.log("  ※ bun run dev が起動中の場合は停止してください（イベントが競合します）");
  console.log("");

  const channelId = await ask("  テスト先 チャンネルID (C...) or ユーザーID (U...): ");
  if (!channelId) {
    console.error("  チャンネルIDは必須です。");
    process.exit(1);
  }

  // ---- Slack App 起動 ----
  const app = new App({
    token: config.slackBotToken,
    appToken: config.slackAppToken,
    signingSecret: config.slackSigningSecret,
    socketMode: true,
  });

  // ---- アクションハンドラ登録 ----
  app.action<BlockAction>(/^hitl:/, async ({ action, ack, body, client }) => {
    await ack();
    if (action.type !== "button") return;

    const parts = action.action_id.split(":");
    const actionType = parts[1];
    const requestId = parts[2];
    const ch = body.channel?.id;

    if (actionType === "yes" || actionType === "no") {
      const answer = actionType === "yes" ? "はい" : "いいえ";
      resolvePendingHitl(requestId, answer);
      if (ch && "message" in body) {
        await client.chat.update({
          channel: ch,
          ts: (body as { message: { ts: string } }).message.ts,
          text: `=> ${answer}`,
          blocks: [],
        });
      }
    } else if (actionType === "choice") {
      const value = action.value || parts[3] || "";
      resolvePendingHitl(requestId, value);
      if (ch && "message" in body) {
        await client.chat.update({
          channel: ch,
          ts: (body as { message: { ts: string } }).message.ts,
          text: `=> ${value}`,
          blocks: [],
        });
      }
    } else if (actionType === "yes_but" || actionType === "freeform") {
      const title = actionType === "yes_but" ? "条件付き承認" : "自由回答";
      const triggerId = (body as { trigger_id?: string }).trigger_id;
      if (triggerId) {
        await client.views.open({
          trigger_id: triggerId,
          view: buildFreeformModal(requestId, title) as Parameters<
            typeof client.views.open
          >[0]["view"],
        });
      }
    }
  });

  app.view<ViewSubmitAction>(/^hitl_modal:/, async ({ view, ack }) => {
    await ack();
    const requestId = view.callback_id.split(":")[1];
    const answer = view.state.values.answer_block?.answer_input?.value || "(空の回答)";
    resolvePendingHitl(requestId, answer);
  });

  console.log("");
  console.log("  Slack に接続中...");
  await app.start();
  console.log("  接続しました。");

  // ---- チャンネル参加確認 ----
  try {
    await app.client.conversations.join({ channel: channelId });
  } catch {
    // already in channel
  }

  // ---- テスト実行 ----
  const results: { name: string; answer: string; ok: boolean }[] = [];
  const TIMEOUT_MS = 60_000;

  for (let i = 0; i < testCases.length; i++) {
    const tc = testCases[i];
    console.log("");
    console.log(`  [Test ${i + 1}/${testCases.length}] ${tc.name}`);
    console.log("  Slack にメッセージを送信中...");

    const requestId = `test-${tc.hitl.type}-${Date.now().toString(36)}`;
    const blocks = buildHitlBlocks(requestId, tc.hitl);

    await app.client.chat.postMessage({
      channel: channelId,
      text: tc.hitl.question,
      blocks,
    });

    console.log("  Slack でボタンを押してください (60秒以内)...");
    const answer = await waitForHitl(requestId, TIMEOUT_MS);
    const timedOut = answer.includes("タイムアウト");

    if (timedOut) {
      console.log("  => タイムアウトしました");
      results.push({ name: tc.name, answer, ok: false });
    } else {
      console.log(`  => 回答: "${answer}"`);
      results.push({ name: tc.name, answer, ok: true });
    }
  }

  // ---- 結果サマリー ----
  console.log("");
  console.log("=================================");
  console.log("  テスト結果");
  console.log("=================================");

  const passCount = results.filter((r) => r.ok).length;
  for (const r of results) {
    const mark = r.ok ? "PASS" : "FAIL";
    console.log(`  [${mark}] ${r.name}: ${r.answer}`);
  }

  console.log("");
  console.log(`  ${passCount}/${results.length} 通過`);

  if (passCount === results.length) {
    console.log("  HITL は正常に動作しています!");

    await app.client.chat.postMessage({
      channel: channelId,
      text: `HITL テスト完了: ${passCount}/${results.length} 通過`,
    });
  } else {
    console.log("  一部のテストが失敗しました。Slack App の設定を確認してください。");
  }

  console.log("");
  await app.stop();
  rl.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
