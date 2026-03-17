import { App, type BlockAction, type ViewSubmitAction } from "@slack/bolt";
import { config } from "./config";
import { askAgent } from "./agent";
import {
  parseHitlFromResult,
  buildHitlBlocks,
  waitForHitl,
  resolvePendingHitl,
  buildFreeformModal,
} from "./hitl";
import { saveDecision } from "./knowledge";
import {
  loadRules,
  getMessageRule,
  getReactionRule,
  isWatchedChannel,
} from "./rules";
import { shouldProcess } from "./guard";

const app = new App({
  token: config.slackBotToken,
  appToken: config.slackAppToken,
  signingSecret: config.slackSigningSecret,
  socketMode: true,
});

// --------------------------------------------------
// メンション → 常に処理（ガードなし）
// --------------------------------------------------
app.event("app_mention", async ({ event, say, client }) => {
  const threadTs = event.thread_ts || event.ts;
  const contextKey = `${event.channel}-${threadTs}`;

  const userInfo = await client.users.info({ user: event.user });
  const userName =
    userInfo.user?.real_name || userInfo.user?.name || "unknown";

  const prompt = [
    `[Slack] ${userName} からのメンション:`,
    event.text,
  ].join("\n");

  const result = await askAgent(prompt, contextKey);
  await handleAgentResult(result, contextKey, event.channel, threadTs, say);
});

// --------------------------------------------------
// リアクション → rules.json のルールに従う
// --------------------------------------------------
app.event("reaction_added", async ({ event, client }) => {
  const channelId = event.item.channel;
  const rule = getReactionRule(channelId, event.reaction);
  if (!rule) return;

  // ガードチェック
  if (rule.guard) {
    const original = await fetchOriginalMessage(client, channelId, event.item.ts);
    if (!original) return;
    if (!(await shouldProcess(original))) return;
  }

  const message = await fetchOriginalMessage(client, channelId, event.item.ts);
  if (!message) return;

  const contextKey = `reaction-${channelId}-${event.item.ts}`;
  const prompt = [
    `[Slack] メッセージに :${event.reaction}: リアクションが付きました。`,
    `メッセージ: ${message}`,
    "",
    `アクション: ${rule.prompt}`,
  ].join("\n");

  const agentResult = await askAgent(prompt, contextKey);
  await handleAgentResultDirect(
    agentResult,
    contextKey,
    channelId,
    event.item.ts,
    client,
  );
});

// --------------------------------------------------
// チャンネル投稿 → rules.json で on_message が定義されたチャンネルのみ
// --------------------------------------------------
app.message(async ({ message, say, client }) => {
  if (!("channel" in message) || !("text" in message)) return;
  if (message.subtype) return;
  if (!message.text) return;
  if (!isWatchedChannel(message.channel)) return;

  const rule = getMessageRule(message.channel);
  if (!rule) return;

  // ガードチェック
  if (rule.guard) {
    if (!(await shouldProcess(message.text))) return;
  }

  const contextKey = `${message.channel}-${message.ts}`;

  const userInfo = "user" in message && message.user
    ? await client.users.info({ user: message.user })
    : null;
  const userName =
    userInfo?.user?.real_name || userInfo?.user?.name || "unknown";

  const prompt = [
    `[Slack] ${userName} の投稿:`,
    message.text,
    "",
    `アクション: ${rule.prompt}`,
    "",
    "アクションが不要な場合は NO_ACTION を返してください。",
  ].join("\n");

  const result = await askAgent(prompt, contextKey);
  await handleAgentResult(
    result,
    contextKey,
    message.channel,
    message.ts,
    say,
  );
});

// --------------------------------------------------
// HITL ボタンアクション
// --------------------------------------------------
app.action<BlockAction>(/^hitl:/, async ({ action, ack, body, client }) => {
  await ack();
  if (action.type !== "button") return;

  const parts = action.action_id.split(":");
  const actionType = parts[1];
  const requestId = parts[2];
  const channelId = body.channel?.id;

  if (actionType === "yes" || actionType === "no") {
    const answer = actionType === "yes" ? "はい" : "いいえ";
    resolvePendingHitl(requestId, answer);
    if (channelId && "message" in body) {
      await client.chat.update({
        channel: channelId,
        ts: (body as { message: { ts: string } }).message.ts,
        text: `=> ${answer}`,
        blocks: [],
      });
    }
  } else if (actionType === "choice") {
    const value = action.value || parts[3] || "";
    resolvePendingHitl(requestId, value);
    if (channelId && "message" in body) {
      await client.chat.update({
        channel: channelId,
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

// --------------------------------------------------
// モーダル送信
// --------------------------------------------------
app.view<ViewSubmitAction>(/^hitl_modal:/, async ({ view, ack }) => {
  await ack();
  const requestId = view.callback_id.split(":")[1];
  const answer =
    view.state.values.answer_block?.answer_input?.value || "(空の回答)";
  resolvePendingHitl(requestId, answer);
});

// --------------------------------------------------
// ヘルパー (export for testing)
// --------------------------------------------------

export async function fetchOriginalMessage(
  client: { conversations: { history: (args: Record<string, unknown>) => Promise<{ messages?: { text?: string }[] }> } },
  channel: string,
  ts: string,
): Promise<string | null> {
  const result = await client.conversations.history({
    channel,
    latest: ts,
    inclusive: true,
    limit: 1,
  });
  return result.messages?.[0]?.text ?? null;
}

export async function handleAgentResult(
  result: string,
  contextKey: string,
  channel: string,
  threadTs: string,
  say: (args: {
    text: string;
    thread_ts: string;
    blocks?: unknown[];
  }) => Promise<unknown>,
) {
  const { hitl, cleanText } = parseHitlFromResult(result);

  if (cleanText && cleanText !== "NO_ACTION") {
    await say({ text: cleanText, thread_ts: threadTs });
  }

  if (hitl) {
    const requestId = `${channel}-${Date.now().toString(36)}`;
    const blocks = buildHitlBlocks(requestId, hitl);
    await say({ blocks, text: hitl.question, thread_ts: threadTs });

    const answer = await waitForHitl(requestId);
    const followUp = await askAgent(`ユーザーの回答: ${answer}`, contextKey);
    await saveDecision(hitl.question, answer, hitl.context);

    const { cleanText: followUpText } = parseHitlFromResult(followUp);
    if (followUpText && followUpText !== "NO_ACTION") {
      await say({ text: followUpText, thread_ts: threadTs });
    }
  }
}

export async function handleAgentResultDirect(
  result: string,
  contextKey: string,
  channel: string,
  threadTs: string,
  client: { chat: { postMessage: (args: Record<string, unknown>) => Promise<unknown> } },
) {
  const { hitl, cleanText } = parseHitlFromResult(result);

  if (cleanText && cleanText !== "NO_ACTION") {
    await client.chat.postMessage({
      channel,
      text: cleanText,
      thread_ts: threadTs,
    });
  }

  if (hitl) {
    const requestId = `${channel}-${Date.now().toString(36)}`;
    const blocks = buildHitlBlocks(requestId, hitl);
    await client.chat.postMessage({
      channel,
      blocks,
      text: hitl.question,
      thread_ts: threadTs,
    });

    const answer = await waitForHitl(requestId);
    const followUp = await askAgent(`ユーザーの回答: ${answer}`, contextKey);
    await saveDecision(hitl.question, answer, hitl.context);

    const { cleanText: followUpText } = parseHitlFromResult(followUp);
    if (followUpText && followUpText !== "NO_ACTION") {
      await client.chat.postMessage({
        channel,
        text: followUpText,
        thread_ts: threadTs,
      });
    }
  }
}

// --------------------------------------------------
// 起動
// --------------------------------------------------
export { app };

export async function start() {
  const rules = await loadRules();
  const channelCount = Object.keys(rules.channels).filter(
    (k) => !k.startsWith("_"),
  ).length;

  await app.start();
  console.log("AIPM is running!");
  console.log(`  Channels configured: ${channelCount}`);
  console.log(`  Guard model: ${rules.guard?.model || "(disabled)"}`);
}

if (import.meta.main) {
  start();
}
