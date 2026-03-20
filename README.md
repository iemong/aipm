# AIPM - AI Personal Project Manager

Slack を通じてプロジェクト管理を支援する AI パーソナル PM。Claude Agent SDK + Slack Bolt で構築。

## セットアップ

```bash
bun install
bun run setup
```

セットアップウィザードで以下を設定:
- Slack Bot Token / App Token / Signing Secret
- Notion CLI (`ntn auth login`)
- GitHub CLI (`gh auth login`)
- Sentry CLI (`sentry auth login`)
- HITL 承認チャンネル（Bash Guard 用）
- ペルソナ設定

## コマンド

| コマンド | 説明 |
|---------|------|
| `bun run dev` | AIPM 起動 |
| `bun run setup` | 初回セットアップ |
| `bun run project:create` | プロジェクトを対話式に作成 |
| `bun run project:list` | プロジェクト一覧 |
| `bun run test:hitl` | HITL 動作確認（Slack 上でボタン操作をテスト） |
| `bun test` | テスト実行 |

## アーキテクチャ

```
Slack Event (メンション/リアクション/メッセージ)
  → index.ts (イベントハンドラ)
  → agent.ts (Claude Agent SDK)
  → HITL (確認が必要な場合 → Slack ボタン → ユーザー承認)
  → knowledge (ADR として判断を記録)
```

### プロジェクト管理

チャンネルとプロジェクトは 1:1 で対応:

```
projects/
└── my-app/
    ├── project.ts       # プロジェクト設定
    └── knowledge/       # プロジェクトスコープの ADR
```

`bun run project:create` で対話式に作成。作成後 `rules.ts` にチャンネルルールを手動追加。

### Bash Guard（セキュリティ）

エージェントは直接 Bash を実行できない。代わりに MCP サーバー (`mcp-servers/bash-guard/`) を通じてコマンドを実行:

1. `bash-whitelist.ts` のパターンに合致 → 即座に実行
2. 合致しない → Slack の HITL チャンネルでユーザー承認を要求
3. HITL チャンネル未設定 → ホワイトリスト外は全て拒否

```
Agent → execute_command("git log -5")
  → bash-guard MCP server
    → ホワイトリストに合致? → 実行
    → 合致しない? → HTTP → HITL Bridge → Slack 承認
```

### 主要ファイル

| ファイル | 説明 |
|---------|------|
| `src/index.ts` | Slack Bolt アプリ + イベントハンドラ |
| `src/agent.ts` | Claude Agent SDK ラッパー |
| `src/project.ts` | プロジェクト設定スキーマ + ローダー |
| `src/knowledge.ts` | ADR 保存・検索（プロジェクトスコープ対応） |
| `src/hitl.ts` | HITL パース・ブロック生成 |
| `src/hitl-bridge.ts` | Bash Guard 用 HTTP HITL ブリッジ |
| `src/bash-guard.ts` | Bash ホワイトリスト管理 |
| `rules.ts` | チャンネルルール定義 |
| `bash-whitelist.ts` | Bash ホワイトリスト定義 |
| `persona.md` | AI のペルソナ設定 |

## 環境変数

| 変数 | 説明 |
|-----|------|
| `SLACK_BOT_TOKEN` | Slack Bot Token (xoxb-) |
| `SLACK_APP_TOKEN` | Slack App-Level Token (xapp-) |
| `SLACK_SIGNING_SECRET` | Slack Signing Secret |
| `SLACK_HITL_CHANNEL` | Bash Guard HITL 承認先（チャンネルID `C...` またはユーザーID `U...` でDM） |
| `AIPM_HITL_BRIDGE_PORT` | HITL Bridge ポート (default: 3456) |
