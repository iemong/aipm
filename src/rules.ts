import { z } from "zod";

// --------------------------------------------------
// Schema
// --------------------------------------------------

const reactionRuleSchema = z.object({
  prompt: z.string(),
  guard: z.boolean().optional(),
});

const messageRuleSchema = z.object({
  guard: z.boolean().optional(),
  prompt: z.string(),
});

const channelRuleSchema = z.object({
  name: z.string().optional(),
  on_message: messageRuleSchema.optional(),
  on_reaction: z.record(z.string(), reactionRuleSchema).optional(),
});

const guardConfigSchema = z.object({
  model: z.string().optional(),
  prompt: z.string().optional(),
});

const rulesSchema = z.object({
  guard: guardConfigSchema.optional(),
  channels: z.record(z.string(), channelRuleSchema),
});

// --------------------------------------------------
// Types (exported from schema)
// --------------------------------------------------

export type ReactionRule = z.infer<typeof reactionRuleSchema>;
export type MessageRule = z.infer<typeof messageRuleSchema>;
export type ChannelRule = z.infer<typeof channelRuleSchema>;
export type GuardConfig = z.infer<typeof guardConfigSchema>;
export type Rules = z.infer<typeof rulesSchema>;

// --------------------------------------------------
// State
// --------------------------------------------------

let rules: Rules | null = null;

// --------------------------------------------------
// Load
// --------------------------------------------------

export async function loadRules(): Promise<Rules> {
  try {
    const mod = await import("../rules");
    const raw = mod.default ?? mod;
    rules = rulesSchema.parse(raw);
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error("[rules] バリデーションエラー:");
      for (const issue of error.issues) {
        console.error(`  ${issue.path.join(".")}: ${issue.message}`);
      }
      process.exit(1);
    }
    rules = { channels: {} };
    console.warn("[rules] rules.ts が見つかりません。デフォルト設定を使用します。");
  }
  return rules;
}

// --------------------------------------------------
// Accessors
// --------------------------------------------------

export function getRules(): Rules {
  if (!rules) throw new Error("loadRules() を先に呼んでください");
  return rules;
}

export function getChannelRule(channelId: string): ChannelRule | undefined {
  return rules?.channels[channelId];
}

export function getMessageRule(channelId: string): MessageRule | undefined {
  return rules?.channels[channelId]?.on_message;
}

export function getReactionRule(channelId: string, reaction: string): ReactionRule | undefined {
  return rules?.channels[channelId]?.on_reaction?.[reaction];
}

export function getGuardConfig(): GuardConfig {
  return rules?.guard ?? {};
}

export function isWatchedChannel(channelId: string): boolean {
  const rule = rules?.channels[channelId];
  return !!rule && (!!rule.on_message || !!rule.on_reaction);
}
