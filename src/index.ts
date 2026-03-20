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

function formatResources(res: NonNullable<Project["config"]["resources"]>): string[] {
  const lines: string[] = [];
  for (const dir of res.directories) {
    if (lines.length === 0 || !lines.includes("  参照ディレクトリ:"))
      lines.push("  参照ディレクトリ:");
    lines.push(`    - ${dir.label}: ${dir.path}${dir.description ? ` — ${dir.description}` : ""}`);
  }
  for (const link of res.links) {
    if (!lines.includes("  参照リンク:")) lines.push("  参照リンク:");
    lines.push(
      `    - ${link.label}: ${link.url}${link.description ? ` — ${link.description}` : ""}`,
    );
  }
  if (res.instructions) lines.push("", `[チャンネル固有の指示]`, res.instructions);
  return lines;
}

function buildProjectContext(project: Project): string {
  const lines = [`[プロジェクト] ${project.config.name} (${project.slug})`];
  if (project.config.channelName) lines.push(`  チャンネル: ${project.config.channelName}`);
  if (project.config.description) lines.push(`  説明: ${project.config.description}`);
  if (project.config.github)
    lines.push(`  GitHub: ${project.config.github.owner}/${project.config.github.repo}`);
  if (project.config.resources) lines.push(...formatResources(project.config.resources));
  return lines.join("\n");
}

// --------------------------------------------------
// プロンプト組み立て
// --------------------------------------------------

async function buildPrompt(channel: string, parts: string[]): Promise<string> {
  const project = await findProjectByChannel(channel);
  const promptParts = project ? [buildProjectContext(project), ...parts] : parts;
  return promptParts.join("\n");
}

// --------------------------------------------------
// メンション → 常に処理（ガードなし）
// --------------------------------------------------
app.event("app_mention", async ({ event, say, client }) => {
  const threadTs = event.thread_ts || event.ts;
  const contextKey = `${event.channel}-${threadTs}`;

  const userInfo = await client.users.info({ user: event.user });
  const userName = userInfo.user?.real_name || userInfo.user?.name || "unknown";
  const prompt = await buildPrompt(event.channel, [
    `[Slack] ${userName} からのメンション:`,
    event.text,
  ]);

  const result = await askAgent(prompt, contextKey);
  await handleAgentResult({ result, contextKey, channel: event.channel, threadTs, say, client });
});

// --------------------------------------------------
// リアクション → rules.json のルールに従う
// --------------------------------------------------
// oxlint-disable-next-line max-params
async function getGuardedMessage(
  client: {
    conversations: {
      history: (args: Record<string, unknown>) => Promise<{ messages?: { text?: string }[] }>;
    };
  },
  channelId: string,
  ts: string,
  guard?: boolean,
): Promise<string | null> {
  if (guard) {
    const original = await fetchOriginalMessage(client, channelId, ts);
    if (!original || !(await shouldProcess(original, channelId))) return null;
  }
  return fetchOriginalMessage(client, channelId, ts);
}

app.event("reaction_added", async ({ event, client }) => {
  const channelId = event.item.channel;
  const rule = getReactionRule(channelId, event.reaction);
  if (!rule) return;

  const message = await getGuardedMessage(client, channelId, event.item.ts, rule.guard);
  if (!message) return;

  const contextKey = `reaction-${channelId}-${event.item.ts}`;
  const prompt = await buildPrompt(channelId, [
    `[Slack] メッセージに :${event.reaction}: リアクションが付きました。`,
    `メッセージ: ${message}`,
    "",
    `アクション: ${rule.prompt}`,
  ]);

  const agentResult = await askAgent(prompt, contextKey);
  await handleAgentResult({
    result: agentResult,
    contextKey,
    channel: channelId,
    threadTs: event.item.ts,
    client,
  });
});

// --------------------------------------------------
// チャンネル投稿 → rules.json で on_message が定義されたチャンネルのみ
// --------------------------------------------------
// oxlint-disable-next-line max-statements
app.message(async ({ message, say, client }) => {
  if (!("channel" in message) || !("text" in message)) return;
  if (message.subtype || !message.text || !isWatchedChannel(message.channel)) return;

  const rule = getMessageRule(message.channel);
  if (!rule) return;
  if (rule.guard && !(await shouldProcess(message.text, message.channel))) return;

  const userId = "user" in message ? (message.user as string | undefined) : undefined;
  const userName = userId
    ? (await client.users.info({ user: userId })).user?.real_name || "unknown"
    : "unknown";
  const contextKey = `${message.channel}-${message.ts}`;

  const prompt = await buildPrompt(message.channel, [
    `[Slack] ${userName} の投稿:`,
    message.text,
    "",
    `アクション: ${rule.prompt}`,
    "",
    "アクションが不要な場合は NO_ACTION を返してください。",
  ]);
  const result = await askAgent(prompt, contextKey);
  await handleAgentResult({
    result,
    contextKey,
    channel: message.channel,
    threadTs: message.ts,
    say,
    client,
  });
});

// --------------------------------------------------
// HITL ボタンアクション
// --------------------------------------------------
// oxlint-disable-next-line max-params
async function resolveAndUpdate(
  answer: string,
  requestId: string,
  body: Record<string, unknown>,
  client: { chat: { update: (args: Record<string, unknown>) => Promise<unknown> } },
) {
  resolvePendingHitl(requestId, answer);
  const channelId = (body.channel as { id?: string })?.id;
  if (channelId && "message" in body) {
    await client.chat.update({
      channel: channelId,
      ts: (body as { message: { ts: string } }).message.ts,
      text: `=> ${answer}`,
      blocks: [],
    });
  }
}

// oxlint-disable-next-line max-statements
app.action<BlockAction>(/^hitl:/, async ({ action, ack, body, client }) => {
  await ack();
  if (action.type !== "button") return;

  const parts = action.action_id.split(":");
  const [, actionType, requestId] = parts;

  if (actionType === "yes" || actionType === "no") {
    await resolveAndUpdate(actionType === "yes" ? "はい" : "いいえ", requestId, body, client);
  } else if (actionType === "choice") {
    await resolveAndUpdate(action.value || parts[3] || "", requestId, body, client);
  } else if (actionType === "yes_but" || actionType === "freeform") {
    const triggerId = (body as { trigger_id?: string }).trigger_id;
    if (triggerId) {
      const title = actionType === "yes_but" ? "条件付き承認" : "自由回答";
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

// --------------------------------------------------
// メッセージ送信の抽象化
// --------------------------------------------------

type SendFn = (args: { text: string; thread_ts: string; blocks?: unknown[] }) => Promise<unknown>;
type PostClient = { chat: { postMessage: (args: Record<string, unknown>) => Promise<unknown> } };

function makeSendFromClient(client: PostClient, channel: string): SendFn {
  return (args) => client.chat.postMessage({ channel, ...args });
}

// --------------------------------------------------
// HITL処理の共通化
// --------------------------------------------------

interface HitlContext {
  contextKey: string;
  channel: string;
  threadTs: string;
  send: SendFn;
  postToHitl: PostClient;
}

async function sendHitlBlocks(
  requestId: string,
  hitl: import("./hitl").HitlRequest,
  ctx: HitlContext,
): Promise<void> {
  const blocks = buildHitlBlocks(requestId, hitl);
  const hitlChannel = config.slackHitlChannel;
  if (hitlChannel) {
    await ctx.postToHitl.chat.postMessage({
      channel: hitlChannel,
      blocks,
      text: `[${ctx.channel}] ${hitl.question}`,
    });
  } else {
    await ctx.send({ blocks, text: hitl.question, thread_ts: ctx.threadTs });
  }
}

async function handleHitl(hitl: import("./hitl").HitlRequest, ctx: HitlContext): Promise<void> {
  const requestId = `${ctx.channel}-${Date.now().toString(36)}`;
  await sendHitlBlocks(requestId, hitl, ctx);

  const answer = await waitForHitl(requestId);
  const followUp = await askAgent(`ユーザーの回答: ${answer}`, ctx.contextKey);
  try {
    await saveDecision(ctx.channel, hitl.question, answer, hitl.context);
  } catch (e) {
    console.error("[knowledge] ADR保存に失敗:", e);
  }

  const { cleanText: followUpText } = parseHitlFromResult(followUp);
  if (followUpText && followUpText !== "NO_ACTION") {
    await ctx.send({ text: followUpText, thread_ts: ctx.threadTs });
  }
}

// --------------------------------------------------
// ハンドオフ処理
// --------------------------------------------------

async function findOrCreateActivityFile(slug: string, handoff: string): Promise<string | null> {
  const activities = await listActivities(slug, { status: "investigating" });
  if (activities.length > 0) return activities[0].filename;

  const titleMatch = handoff.match(/^#\s+タスク:\s*(.+)$/m);
  const trigger = titleMatch ? titleMatch[1].trim() : "ハンドオフプロンプト";
  await createActivity(slug, { trigger });
  const created = await listActivities(slug, { status: "investigating" });
  return created[0]?.filename ?? null;
}

async function saveHandoffToActivity(handoff: string, channel: string): Promise<void> {
  const project = await findProjectByChannel(channel);
  if (!project) {
    console.warn("[handoff] プロジェクトが見つかりません:", channel);
    return;
  }

  const filename = await findOrCreateActivityFile(project.slug, handoff);
  if (!filename) {
    console.error("[handoff] 活動記録の作成に失敗");
    return;
  }

  const ok = await appendHandoffPrompt(project.slug, filename, handoff);
  console.log(ok ? `[handoff] 活動記録に追記: ${filename}` : `[handoff] 追記に失敗: ${filename}`);
}

function formatHandoffMessage(handoff: string): string {
  return `*ハンドオフプロンプト*\n以下をCursor/Claude Desktopにコピーして実行してください:\n\n\`\`\`\n${handoff}\n\`\`\``;
}

// --------------------------------------------------
// エージェント応答の統合処理
// --------------------------------------------------

async function processAgentResult(result: string, ctx: HitlContext): Promise<void> {
  const { handoff, cleanText: textAfterHandoff } = parseHandoffFromResult(result);
  const { hitl, cleanText } = parseHitlFromResult(textAfterHandoff);

  if (cleanText && cleanText !== "NO_ACTION") {
    await ctx.send({ text: cleanText, thread_ts: ctx.threadTs });
  }
  if (handoff) {
    await saveHandoffToActivity(handoff, ctx.channel);
    await ctx.send({ text: formatHandoffMessage(handoff), thread_ts: ctx.threadTs });
  }
  if (hitl) {
    await handleHitl(hitl, ctx);
  }
}

export interface AgentResultOpts {
  result: string;
  contextKey: string;
  channel: string;
  threadTs: string;
  say?: SendFn;
  client: PostClient;
}

export async function handleAgentResult(opts: AgentResultOpts) {
  const send = opts.say ?? makeSendFromClient(opts.client, opts.channel);
  await processAgentResult(opts.result, {
    contextKey: opts.contextKey,
    channel: opts.channel,
    threadTs: opts.threadTs,
    send,
    postToHitl: opts.client,
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

  console.log(
    `Mimamori is running!\n  Channels configured: ${channelCount}\n  Guard model: ${rules.guard?.model || "(disabled)"}\n  HITL channel: ${hitlChannel || "(disabled)"}`,
  );
}

if (import.meta.main) {
  start();
}
