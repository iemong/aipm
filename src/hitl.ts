import type { KnownBlock } from "@slack/bolt";

export interface HitlRequest {
  question: string;
  type: "confirm" | "choice" | "freeform";
  options?: string[];
  context?: string;
}

interface PendingHitl {
  resolve: (answer: string) => void;
}

const pendingRequests = new Map<string, PendingHitl>();

/**
 * エージェントの応答からHITLリクエストをパースする
 */
export function parseHitlFromResult(text: string): {
  hitl: HitlRequest | null;
  cleanText: string;
} {
  const regex = /:::HITL:::\s*([\s\S]*?)\s*:::END_HITL:::/;
  const match = text.match(regex);

  if (!match) return { hitl: null, cleanText: text };

  try {
    const hitl = JSON.parse(match[1]) as HitlRequest;
    const cleanText = text.replace(regex, "").trim();
    return { hitl, cleanText };
  } catch {
    return { hitl: null, cleanText: text };
  }
}

/**
 * HITLリクエストをSlack Block Kitブロックに変換する
 */
export function buildHitlBlocks(
  requestId: string,
  hitl: HitlRequest,
): KnownBlock[] {
  const blocks: KnownBlock[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*確認が必要です*\n\n${hitl.question}`,
      },
    },
  ];

  if (hitl.context) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: hitl.context }],
    });
  }

  if (hitl.type === "choice" && hitl.options) {
    // 選択肢ボタンを生成
    blocks.push({
      type: "actions",
      block_id: `hitl_actions_${requestId}`,
      elements: hitl.options.map((opt, i) => ({
        type: "button" as const,
        text: { type: "plain_text" as const, text: opt, emoji: true },
        action_id: `hitl:choice:${requestId}:${i}`,
        value: opt,
      })),
    });
  } else {
    // confirm / freeform: 4ボタン（はい/いいえ/はい、ただし.../自由回答）
    blocks.push({
      type: "actions",
      block_id: `hitl_actions_${requestId}`,
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "はい", emoji: true },
          action_id: `hitl:yes:${requestId}`,
          style: "primary",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "いいえ", emoji: true },
          action_id: `hitl:no:${requestId}`,
          style: "danger",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "はい、ただし...", emoji: true },
          action_id: `hitl:yes_but:${requestId}`,
        },
        {
          type: "button",
          text: { type: "plain_text", text: "自由回答", emoji: true },
          action_id: `hitl:freeform:${requestId}`,
        },
      ],
    });
  }

  return blocks;
}

/**
 * HITLレスポンスを待機する（タイムアウト付き）
 */
export function waitForHitl(
  requestId: string,
  timeoutMs = 300_000,
): Promise<string> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(requestId);
      resolve("タイムアウト（5分以内に回答がありませんでした）");
    }, timeoutMs);

    pendingRequests.set(requestId, {
      resolve: (answer: string) => {
        clearTimeout(timer);
        resolve(answer);
      },
    });
  });
}

/**
 * 保留中のHITLリクエストを解決する
 */
export function resolvePendingHitl(
  requestId: string,
  answer: string,
): boolean {
  const pending = pendingRequests.get(requestId);
  if (pending) {
    pending.resolve(answer);
    pendingRequests.delete(requestId);
    return true;
  }
  return false;
}

/**
 * 自由記述用のモーダルViewを生成する
 */
export function buildFreeformModal(
  requestId: string,
  title: string,
): Record<string, unknown> {
  return {
    type: "modal",
    callback_id: `hitl_modal:${requestId}`,
    title: { type: "plain_text", text: title.slice(0, 24) },
    submit: { type: "plain_text", text: "送信" },
    blocks: [
      {
        type: "input",
        block_id: "answer_block",
        element: {
          type: "plain_text_input",
          action_id: "answer_input",
          multiline: true,
          placeholder: {
            type: "plain_text",
            text: "回答を入力してください...",
          },
        },
        label: { type: "plain_text", text: "回答" },
      },
    ],
  };
}
