import type { Server } from "bun";
import { buildHitlBlocks, waitForHitl, type HitlRequest } from "./hitl";

// --------------------------------------------------
// Types
// --------------------------------------------------

interface SlackClient {
  chat: {
    postMessage: (args: Record<string, unknown>) => Promise<unknown>;
  };
}

// --------------------------------------------------
// State
// --------------------------------------------------

let server: Server | null = null;

// --------------------------------------------------
// Server
// --------------------------------------------------

async function handleApproveRequest(
  req: Request,
  client: SlackClient,
  channel: string,
): Promise<Response> {
  const { command } = (await req.json()) as { command: string };
  const requestId = `bash-${Date.now().toString(36)}`;
  const hitl: HitlRequest = {
    question: `コマンド実行の確認:\n\`\`\`\n${command}\n\`\`\`\nこのコマンドを実行しますか？`,
    type: "confirm",
    context: "エージェントがBashコマンドの実行を要求しています（ホワイトリスト外）",
  };

  const blocks = buildHitlBlocks(requestId, hitl);
  await client.chat.postMessage({ channel, text: hitl.question, blocks });

  const answer = await waitForHitl(requestId, 120_000);
  return Response.json({ approved: answer === "はい", answer });
}

export function startHitlBridge(port: number, client: SlackClient, channel: string): Server {
  server = Bun.serve({
    port,
    async fetch(req) {
      if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
      if (new URL(req.url).pathname !== "/approve")
        return new Response("Not found", { status: 404 });

      try {
        return await handleApproveRequest(req, client, channel);
      } catch (error) {
        console.error("[hitl-bridge] Error:", error);
        return Response.json({ approved: false, answer: "エラー" }, { status: 500 });
      }
    },
  });

  console.log(`[hitl-bridge] Running on port ${port}`);
  return server;
}

export function stopHitlBridge() {
  server?.stop();
  server = null;
}
