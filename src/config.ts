export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`環境変数 ${name} が設定されていません。bun run setup を実行してください。`);
  }
  return value;
}

export const config = {
  get slackBotToken() {
    return requireEnv("SLACK_BOT_TOKEN");
  },
  get slackAppToken() {
    return requireEnv("SLACK_APP_TOKEN");
  },
  get slackSigningSecret() {
    return requireEnv("SLACK_SIGNING_SECRET");
  },
  get slackHitlChannel() {
    return process.env.SLACK_HITL_CHANNEL || "";
  },
  get hitlBridgePort() {
    return parseInt(process.env.MIMAMORI_HITL_BRIDGE_PORT || "3456", 10);
  },
};
