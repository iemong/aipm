import { z } from "zod";

// --------------------------------------------------
// Schema
// --------------------------------------------------

export const bashWhitelistSchema = z.object({
  patterns: z.array(z.string()),
});

export type BashWhitelist = z.infer<typeof bashWhitelistSchema>;

// --------------------------------------------------
// State
// --------------------------------------------------

let whitelist: BashWhitelist | null = null;

// --------------------------------------------------
// Load
// --------------------------------------------------

function handleWhitelistError(error: unknown): void {
  if (error instanceof z.ZodError) {
    console.error("[bash-guard] バリデーションエラー:");
    for (const issue of error.issues) {
      console.error(`  ${issue.path.join(".")}: ${issue.message}`);
    }
  }
  whitelist = { patterns: [] };
  console.warn(
    "[bash-guard] bash-whitelist.ts が見つかりません。全コマンドにHITL確認を要求します。",
  );
}

export async function loadBashWhitelist(): Promise<BashWhitelist> {
  try {
    const mod = await import("../bash-whitelist");
    whitelist = bashWhitelistSchema.parse(mod.default ?? mod);
  } catch (error) {
    handleWhitelistError(error);
  }
  return whitelist;
}

export function getBashWhitelist(): BashWhitelist {
  if (!whitelist) throw new Error("loadBashWhitelist() を先に呼んでください");
  return whitelist;
}

// --------------------------------------------------
// Matching
// --------------------------------------------------

export function matchPattern(command: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(command);
}

export function isWhitelisted(command: string): boolean {
  if (!whitelist) return false;
  const trimmed = command.trim();
  return whitelist.patterns.some((p) => matchPattern(trimmed, p));
}
