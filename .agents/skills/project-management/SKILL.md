---
name: project-management
description: Mimamoriプロジェクト管理CLIの操作マニュアル。プロジェクトの作成（project:create）、一覧表示（project:list）、rules.tsへのチャンネル登録、knowledgeのプロジェクトスコープ管理について案内する。ユーザーが「プロジェクトを作りたい」「チャンネルを追加したい」「ナレッジの保存先は？」「プロジェクト一覧」などと言った場合に使用する。
---

# Mimamori プロジェクト管理ガイド

## 概要

MimamoriではSlackチャンネルとプロジェクトが1:1で対応する。プロジェクトを作成すると、設定ファイルとプロジェクト専用のknowledgeディレクトリが生成される。

```
projects/
└── my-app/
    ├── project.ts         # プロジェクト設定
    └── knowledge/         # プロジェクトスコープの ADR
        └── *.md
```

## プロジェクトの作成

```bash
bun run project:create
```

対話式ウィザードが起動し、以下の4ステップで進む:

### Step 1: Basic Info
- **プロジェクト名** (必須): 表示名（例: "My App"）
- **スラッグ**: ディレクトリ名。名前から自動生成される（例: "my-app"）
- **説明**: 任意

### Step 2: Slack Channel
- **チャンネルID** (必須): Slackの `C` で始まるID（例: C0123456789）
- **チャンネル名**: 任意（例: #my-app）

既に同じチャンネルIDが別プロジェクトで使われている場合はエラーになる。

### Step 3: GitHub (optional)
- `owner/repo` 形式で入力。Enterでスキップ。

### Step 4: Resources (optional)
- ローカルディレクトリ、外部リンク、チャンネル固有の指示を設定。
- 全てスキップ可能。

### 生成されるファイル
- `projects/{slug}/project.ts` — プロジェクト設定（`ProjectConfig` 型）
- `projects/{slug}/knowledge/.gitkeep` — ADR保存先

## プロジェクト一覧の表示

```bash
bun run project:list
```

全プロジェクトの名前、チャンネルID、GitHub連携状況を一覧表示する。

## プロジェクト作成後のrules.ts編集

`project:create` 完了時にコンソールに表示されるスニペットを `rules.ts` の `channels` に追加する。

```typescript
// rules.ts
const rules = {
  channels: {
    "C0123456789": {
      name: "#my-app",
      on_message: {
        guard: true,
        prompt: "投稿を分析し、必要に応じてナレッジに記録してください。",
      },
    },
  },
} as const satisfies Rules;
```

`rules.ts` はユーザーが手動で編集するファイルなので、CLIからは自動編集しない。

## knowledgeのプロジェクトスコープ

Slackイベント発生時、チャンネルIDからプロジェクトを逆引きし、`projects/{slug}/knowledge/` にADRを保存する。

チャンネルには必ずプロジェクトが紐づいている必要がある。プロジェクト未登録のチャンネルでknowledge保存が発生した場合はエラーになる。

## チャンネルリソース

プロジェクト設定の `resources` フィールドで、チャンネルごとに参照するローカルディレクトリ・外部リンク・固有の指示を定義できる。

### 設定例: Sentryエラー調査

```typescript
const config = {
  name: "sentry-alerts",
  channelId: "C_SENTRY_CH",
  resources: {
    directories: [
      { path: "/Users/me/repos/my-app", label: "メインリポジトリ" },
    ],
    links: [
      { url: "https://sentry.io/my-org/issues/", label: "Sentry" },
    ],
    instructions: "エラー報告が来たらsentry CLIで詳細を調査し、ソースコードから根本原因を特定してください。",
  },
  createdAt: "2026-03-20T00:00:00.000Z",
} as const satisfies ProjectConfig;
```

## プロジェクト設定の型

```typescript
interface ProjectConfig {
  name: string;
  channelId: string;      // Slackチャンネル（1:1）
  channelName?: string;
  description?: string;
  github?: { owner: string; repo: string };
  resources?: {
    directories: { path: string; label: string; description?: string }[];
    links: { url: string; label: string; description?: string }[];
    instructions?: string;
  };
  createdAt: string;
}
```

## 関連コマンド

| コマンド | 説明 |
|---------|------|
| `bun run project:create` | プロジェクトを対話式に作成 |
| `bun run project:list` | プロジェクト一覧を表示 |
| `bun run setup` | 初回セットアップ（Slack/GitHub等） |
| `bun run dev` | Mimamori起動 |
