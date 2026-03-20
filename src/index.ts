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
import { loadRules, getMessageRule, getReactionRule, isWatchedChannel } from "./rules";
import { shouldProcess } from "./guard";
import { findProjectByChannel, type Project } from "./project";
import { startHitlBridge } from "./hitl-bridge";
import { loadBashWhitelist } from "./bash-guard";
import { cleanExpiredSessions } from "./session";
import { parseHandoffFromResult } from "./handoff";
import { appendHandoffPrompt, listActivities, createActivity } from "./activity";

const app = new App({
  token: config.slackBotToken,
  appToken: config.slackAppToken,
  signingSecret: config.slackSigningSecret,
  socketMode: true,
});

// --------------------------------------------------
// プロジェクトコンテキスト
// --------------------------------------------------

function buildProjectContext(project: Project): string {
  const lines = [`[プロジェクト] ${project.config.name} (${project.slug})`];
  if (project.config.channelName) lines.push(`  チャンネル: ${project.config.channelName}`);
  if (project.config.description) lines.push(`  説明: ${project.config.description}`);
  if (project.config.github)
    lines.push(`  GitHub: ${project.config.github.owner}/${project.config.github.repo}`);
  const res = project.config.resources;
  if (res) {
    if (res.directories.length > 0) {
      lines.push("  参照ディレクトリ:");
      for (const dir of res.directories) {
        lines.push(
          `    - ${dir.label}: ${dir.path}${dir.description ? ` — ${dir.description}` : ""}`,
        );
      }
    }
    if (res.links.length > 0) {
      lines.push("  参照リンク:");
      for (const link of res.links) {
        lines.push(
          `    - ${link.label}: ${link.url}${link.description ? ` — ${link.description}` : ""}`,
        );
      }
    }
    if (res.instructions) {
      lines.push("");
      lines.push(`[チャンネル固有の指示]`);
      lines.push(res.instructions);
    }
  }

  return lines.join("\n");
}

// --------------------------------------------------
// メンション → 常に処理（ガードなし）
// --------------------------------------------------
app.event("app_mention", async ({ event, say, client }) => {
  const threadTs = event.thread_ts || event.ts;
  const contextKey = `${event.channel}-${threadTs}`;

  const userInfo = await client.users.info({ user: event.user });
  const userName = userInfo.user?.real_name || userInfo.user?.name || "unknown";

  const project = await findProjectByChannel(event.channel);
  const promptParts = [];
  if (project) promptParts.push(buildProjectContext(project));
  promptParts.push(`[Slack] ${userName} からのメンション:`);
  promptParts.push(event.text);
  const prompt = promptParts.join("\n");

  const result = await askAgent(prompt, contextKey);
  await handleAgentResult(result, contextKey, event.channel, threadTs, say, client);
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
    if (!(await shouldProcess(original, channelId))) return;
  }

  const message = await fetchOriginalMessage(client, channelId, event.item.ts);
  if (!message) return;

  const contextKey = `reaction-${channelId}-${event.item.ts}`;
  const project = await findProjectByChannel(channelId);
  const promptParts = [];
  if (project) promptParts.push(buildProjectContext(project));
  promptParts.push(
    `[Slack] メッセージに :${event.reaction}: リアクションが付きました。`,
    `メッセージ: ${message}`,
    "",
    `アクション: ${rule.prompt}`,
  );
  const prompt = promptParts.join("\n");

  const agentResult = await askAgent(prompt, contextKey);
  await handleAgentResultDirect(agentResult, contextKey, channelId, event.item.ts, client);
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
    if (!(await shouldProcess(message.text, message.channel))) return;
  }

  const contextKey = `${message.channel}-${message.ts}`;

  const userInfo =
    "user" in message && message.user ? await client.users.info({ user: message.user }) : null;
  const userName = userInfo?.user?.real_name || userInfo?.user?.name || "unknown";

  const project = await findProjectByChannel(message.channel);
  const promptParts = [];
  if (project) promptParts.push(buildProjectContext(project));
  promptParts.push(
    `[Slack] ${userName} の投稿:`,
    message.text,
    "",
    `アクション: ${rule.prompt}`,
    "",
    "アクションが不要な場合は NO_ACTION を返してください。",
  );
  const prompt = promptParts.join("\n");

  const result = await askAgent(prompt, contextKey);
  await handleAgentResult(result, contextKey, message.channel, message.ts, say, client);
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
  const answer = view.state.values.answer_block?.answer_input?.value || "(空の回答)";
  resolvePendingHitl(requestId, answer);
});

// --------------------------------------------------
// ヘルパー (export for testing)
// --------------------------------------------------

export async function fetchOriginalMessage(
  client: {
    conversations: {
      history: (args: Record<string, unknown>) => Promise<{ messages?: { text?: string }[] }>;
    };
  },
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
  say: (args: { text: string; thread_ts: string; blocks?: unknown[] }) => Promise<unknown>,
  client: { chat: { postMessage: (args: Record<string, unknown>) => Promise<unknown> } },
) {
  // ハンドオフを先に抽出し、残りテキストからHITLを抽出
  const { handoff, cleanText: textAfterHandoff } = parseHandoffFromResult(result);
  const { hitl, cleanText } = parseHitlFromResult(textAfterHandoff);

  if (cleanText && cleanText !== "NO_ACTION") {
    await say({ text: cleanText, thread_ts: threadTs });
  }

  // ハンドオフが検出された場合: 活動記録に追記 + Slackに投稿
  if (handoff) {
    await processHandoff(handoff, channel, threadTs, say);
  }

  if (hitl) {
    const requestId = `${channel}-${Date.now().toString(36)}`;
    const blocks = buildHitlBlocks(requestId, hitl);
    const hitlChannel = config.slackHitlChannel;
    if (hitlChannel) {
      await client.chat.postMessage({
        channel: hitlChannel,
        blocks,
        text: `[${channel}] ${hitl.question}`,
      });
    } else {
      await say({ blocks, text: hitl.question, thread_ts: threadTs });
    }

    const answer = await waitForHitl(requestId);
    const followUp = await askAgent(`ユーザーの回答: ${answer}`, contextKey);
    try {
      await saveDecision(channel, hitl.question, answer, hitl.context);
    } catch (e) {
      console.error("[knowledge] ADR保存に失敗:", e);
    }

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
  // ハンドオフを先に抽出し、残りテキストからHITLを抽出
  const { handoff, cleanText: textAfterHandoff } = parseHandoffFromResult(result);
  const { hitl, cleanText } = parseHitlFromResult(textAfterHandoff);

  if (cleanText && cleanText !== "NO_ACTION") {
    await client.chat.postMessage({
      channel,
      text: cleanText,
      thread_ts: threadTs,
    });
  }

  // ハンドオフが検出された場合: 活動記録に追記 + Slackに投稿
  if (handoff) {
    await processHandoffDirect(handoff, channel, threadTs, client);
  }

  if (hitl) {
    const requestId = `${channel}-${Date.now().toString(36)}`;
    const blocks = buildHitlBlocks(requestId, hitl);
    const hitlChannel = config.slackHitlChannel;
    await client.chat.postMessage({
      channel: hitlChannel || channel,
      blocks,
      text: hitlChannel ? `[${channel}] ${hitl.question}` : hitl.question,
      ...(hitlChannel ? {} : { thread_ts: threadTs }),
    });

    const answer = await waitForHitl(requestId);
    const followUp = await askAgent(`ユーザーの回答: ${answer}`, contextKey);
    try {
      await saveDecision(channel, hitl.question, answer, hitl.context);
    } catch (e) {
      console.error("[knowledge] ADR保存に失敗:", e);
    }

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
// ハンドオフ処理
// --------------------------------------------------

async function saveHandoffToActivity(handoff: string, channel: string): Promise<void> {
  const project = await findProjectByChannel(channel);
  if (!project) {
    console.warn("[handoff] プロジェクトが見つかりません:", channel);
    return;
  }

  // investigating状態の活動記録を探す
  const activities = await listActivities(project.slug, { status: "investigating" });
  let filename: string;

  if (activities.length > 0) {
    // 最新のinvestigating活動記録に追記
    filename = activities[0].filename;
  } else {
    // なければ新規作成
    const titleMatch = handoff.match(/^#\s+タスク:\s*(.+)$/m);
    const trigger = titleMatch ? titleMatch[1].trim() : "ハンドオフプロンプト";
    await createActivity(project.slug, { trigger });
    const activityFiles = await listActivities(project.slug, { status: "investigating" });
    filename = activityFiles[0]?.filename;
    if (!filename) {
      console.error("[handoff] 活動記録の作成に失敗");
      return;
    }
  }

  const ok = await appendHandoffPrompt(project.slug, filename, handoff);
  if (ok) {
    console.log(`[handoff] 活動記録に追記: ${filename}`);
  } else {
    console.error(`[handoff] 追記に失敗: ${filename}`);
  }
}

async function processHandoff(
  handoff: string,
  channel: string,
  threadTs: string,
  say: (args: { text: string; thread_ts: string }) => Promise<unknown>,
): Promise<void> {
  await saveHandoffToActivity(handoff, channel);
  await say({
    text: `*ハンドオフプロンプト*\n以下をCursor/Claude Desktopにコピーして実行してください:\n\n\`\`\`\n${handoff}\n\`\`\``,
    thread_ts: threadTs,
  });
}

async function processHandoffDirect(
  handoff: string,
  channel: string,
  threadTs: string,
  client: { chat: { postMessage: (args: Record<string, unknown>) => Promise<unknown> } },
): Promise<void> {
  await saveHandoffToActivity(handoff, channel);
  await client.chat.postMessage({
    channel,
    text: `*ハンドオフプロンプト*\n以下をCursor/Claude Desktopにコピーして実行してください:\n\n\`\`\`\n${handoff}\n\`\`\``,
    thread_ts: threadTs,
  });
}

// --------------------------------------------------
// 起動
// --------------------------------------------------
export { app };

export async function start() {
  const rules = await loadRules();
  const channelCount = Object.keys(rules.channels).filter((k) => !k.startsWith("_")).length;

  await loadBashWhitelist();
  await cleanExpiredSessions();

  await app.start();

  // HITL Bridge for bash-guard MCP
  const hitlChannel = config.slackHitlChannel;
  if (hitlChannel) {
    startHitlBridge(config.hitlBridgePort, app.client, hitlChannel);
  } else {
    console.warn(
      "[hitl-bridge] SLACK_HITL_CHANNEL が未設定です。ホワイトリスト外のBashコマンドは全て拒否されます。",
    );
  }

  console.log("Mimamori is running!");
  console.log(`  Channels configured: ${channelCount}`);
  console.log(`  Guard model: ${rules.guard?.model || "(disabled)"}`);
  console.log(`  HITL channel: ${hitlChannel || "(disabled)"}`);
}

if (import.meta.main) {
  start();
}
