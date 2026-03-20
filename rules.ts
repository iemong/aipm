import { z } from "zod";
import type { Rules } from "./src/rules";

const rules = {
  guard: {
    model: "claude-haiku-4-5-20251001",
    prompt:
      "以下のSlackメッセージを見て、何らかのアクション（タスク登録・情報記録・回答など）が必要かを判断してください。" +
      "雑談・独り言・感情的なつぶやき・アクション不要な投稿は「N」、" +
      "仕事に関係する依頼・タスク・質問・報告・情報共有は「Y」と1文字だけ回答してください。",
  },

  channels: {
    // チャンネルIDをキーにしてルールを定義
    // "_EXAMPLE_CHANNEL_ID": {
    //   name: "#example-tasks",
    //   on_message: {
    //     guard: true,
    //     prompt: "チャンネルの投稿を分析し、必要に応じてナレッジに記録してください。",
    //   },
    //   on_reaction: {
    //     memo: {
    //       prompt: "この投稿をナレッジに記録してください。",
    //     },
    //     clipboard: {
    //       prompt: "この投稿の内容をメモとしてナレッジに記録してください。",
    //     },
    //     white_check_mark: {
    //       prompt: "この投稿に関連する対応が完了したことを記録してください。",
    //     },
    //   },
    // },

    C03HG5YKJTB: {
      name: "#times_iemong",
      on_message: {
        guard: true,
        prompt: "投稿を分析し、必要に応じてナレッジに記録してください。",
      },
      on_reaction: {
        memo: { prompt: "ナレッジに記録してください。" },
      },
    },
  },
} as const satisfies Rules;

export default rules;
