import { createInterface } from "node:readline/promises";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { loadProjects, getProjectsDir } from "../src/project";

const rl = createInterface({ input: process.stdin, output: process.stdout });

async function ask(prompt: string, fallback = ""): Promise<string> {
  const answer = await rl.question(prompt);
  return answer.trim() || fallback;
}

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// --------------------------------------------------
// project:create
// --------------------------------------------------

async function create() {
  console.log("");
  console.log("=================================");
  console.log("  Mimamori Project Setup");
  console.log("=================================");
  console.log("");

  // ---- Step 1: Basic Info ----
  console.log("[Step 1/4] Basic Info");
  const name = await ask("  プロジェクト名: ");
  if (!name) {
    console.error("  プロジェクト名は必須です。");
    process.exit(1);
  }
  const defaultSlug = toSlug(name);
  const slug = await ask(`  スラッグ (default: ${defaultSlug}): `, defaultSlug);
  const description = await ask("  説明 (optional): ");

  // ---- Step 2: Slack Channel ----
  console.log("");
  console.log("[Step 2/4] Slack Channel");
  const channelId = await ask("  チャンネルID (C...): ");
  if (!channelId) {
    console.error("  チャンネルIDは必須です。");
    process.exit(1);
  }
  const channelName = await ask("  チャンネル名 (optional, 例: #my-app): ");

  // ---- Duplicate check ----
  const existing = await loadProjects();
  const dup = existing.find((p) => p.config.channelId === channelId);
  if (dup) {
    console.error(
      `  エラー: チャンネルID ${channelId} は既にプロジェクト "${dup.slug}" で使用されています。`,
    );
    process.exit(1);
  }
  const slugDup = existing.find((p) => p.slug === slug);
  if (slugDup) {
    console.error(`  エラー: スラッグ "${slug}" は既に使用されています。`);
    process.exit(1);
  }

  // ---- Step 3: GitHub ----
  console.log("");
  console.log("[Step 3/4] GitHub (optional)");
  const githubInput = await ask("  リポジトリ (owner/repo, Enterでスキップ): ");
  let github: { owner: string; repo: string } | undefined;
  if (githubInput && githubInput.includes("/")) {
    const [owner, repo] = githubInput.split("/", 2);
    github = { owner, repo };
  }

  // ---- Step 4: Resources ----
  console.log("");
  console.log("[Step 4/4] Resources (optional)");
  console.log("  チャンネル専用のローカルディレクトリや外部リンクを設定します。");

  const directories: { path: string; label: string; description?: string }[] = [];
  let addMoreDirs = true;
  while (addMoreDirs) {
    const dirPath = await ask("  ディレクトリパス (Enterでスキップ): ");
    if (!dirPath) {
      addMoreDirs = false;
    } else {
      const dirLabel = await ask("  ラベル (例: メインリポジトリ): ", dirPath);
      const dirDesc = await ask("  説明 (optional): ");
      directories.push({
        path: dirPath,
        label: dirLabel,
        ...(dirDesc ? { description: dirDesc } : {}),
      });
      console.log(`    追加: ${dirLabel} -> ${dirPath}`);
    }
  }

  const links: { url: string; label: string; description?: string }[] = [];
  let addMoreLinks = true;
  while (addMoreLinks) {
    const linkUrl = await ask("  外部リンクURL (Enterでスキップ): ");
    if (!linkUrl) {
      addMoreLinks = false;
    } else {
      const linkLabel = await ask("  ラベル (例: Sentryダッシュボード): ", linkUrl);
      const linkDesc = await ask("  説明 (optional): ");
      links.push({
        url: linkUrl,
        label: linkLabel,
        ...(linkDesc ? { description: linkDesc } : {}),
      });
      console.log(`    追加: ${linkLabel} -> ${linkUrl}`);
    }
  }

  const instructions = await ask("  チャンネル固有の指示 (Enterでスキップ): ");

  const hasResources = directories.length > 0 || links.length > 0 || instructions;

  // ---- Generate files ----
  const projectsDir = getProjectsDir();
  const projectDir = join(projectsDir, slug);
  const knowledgeDir = join(projectDir, "knowledge");

  await mkdir(knowledgeDir, { recursive: true });

  // project.ts
  const configLines: string[] = [
    `import type { ProjectConfig } from "../../src/project";`,
    "",
    `const config = {`,
    `  name: "${name}",`,
    `  channelId: "${channelId}",`,
  ];
  if (channelName) configLines.push(`  channelName: "${channelName}",`);
  if (description) configLines.push(`  description: "${description}",`);
  if (github) {
    configLines.push(`  github: {`);
    configLines.push(`    owner: "${github.owner}",`);
    configLines.push(`    repo: "${github.repo}",`);
    configLines.push(`  },`);
  }
  if (hasResources) {
    configLines.push(`  resources: {`);
    if (directories.length > 0) {
      configLines.push(`    directories: [`);
      for (const dir of directories) {
        const descPart = dir.description ? `, description: "${dir.description}"` : "";
        configLines.push(`      { path: "${dir.path}", label: "${dir.label}"${descPart} },`);
      }
      configLines.push(`    ],`);
    }
    if (links.length > 0) {
      configLines.push(`    links: [`);
      for (const link of links) {
        const descPart = link.description ? `, description: "${link.description}"` : "";
        configLines.push(`      { url: "${link.url}", label: "${link.label}"${descPart} },`);
      }
      configLines.push(`    ],`);
    }
    if (instructions) {
      configLines.push(`    instructions: "${instructions}",`);
    }
    configLines.push(`  },`);
  }
  configLines.push(`  createdAt: "${new Date().toISOString()}",`);
  configLines.push(`} as const satisfies ProjectConfig;`);
  configLines.push("");
  configLines.push("export default config;");
  configLines.push("");

  await writeFile(join(projectDir, "project.ts"), configLines.join("\n"));
  await writeFile(join(knowledgeDir, ".gitkeep"), "");

  console.log("");
  console.log(`  -> ${projectDir}/project.ts を作成しました`);
  console.log(`  -> ${projectDir}/knowledge/ を作成しました`);

  // ---- Next steps ----
  console.log("");
  console.log("  次のステップ:");
  console.log("  rules.ts に以下を追加してください:");
  console.log("");
  const ruleName = channelName || `#${slug}`;
  console.log(`    "${channelId}": {`);
  console.log(`      name: "${ruleName}",`);
  console.log(`      // on_message: { prompt: "..." },`);
  console.log(`      // on_reaction: { memo: { prompt: "..." } },`);
  console.log(`    },`);
  console.log("");

  rl.close();
}

// --------------------------------------------------
// project:list
// --------------------------------------------------

async function list() {
  const projects = await loadProjects();

  if (projects.length === 0) {
    console.log("プロジェクトがありません。bun run project:create で作成してください。");
    return;
  }

  console.log("");
  console.log(`プロジェクト一覧 (${projects.length}件)`);
  console.log("─".repeat(60));

  for (const p of projects) {
    const parts = [`  ${p.slug}`];
    parts.push(`— ${p.config.name}`);
    if (p.config.channelName) parts.push(`(${p.config.channelName})`);
    console.log(parts.join(" "));

    console.log(`    Channel: ${p.config.channelId}`);
    if (p.config.github)
      console.log(`    GitHub:  ${p.config.github.owner}/${p.config.github.repo}`);
    if (p.config.description) console.log(`    ${p.config.description}`);
    if (p.config.resources) {
      const res = p.config.resources;
      if (res.directories.length > 0) {
        console.log(`    Dirs:    ${res.directories.map((d) => d.label).join(", ")}`);
      }
      if (res.links.length > 0) {
        console.log(`    Links:   ${res.links.map((l) => l.label).join(", ")}`);
      }
      if (res.instructions) {
        console.log(
          `    指示:    ${res.instructions.slice(0, 60)}${res.instructions.length > 60 ? "..." : ""}`,
        );
      }
    }
    console.log("");
  }
}

// --------------------------------------------------
// Entry point
// --------------------------------------------------

const command = process.argv[2];

switch (command) {
  case "create":
    create().catch((err) => {
      console.error(err);
      process.exit(1);
    });
    break;
  case "list":
    list().catch((err) => {
      console.error(err);
      process.exit(1);
    });
    break;
  default:
    console.log("Usage:");
    console.log("  bun run project:create   - プロジェクトを作成");
    console.log("  bun run project:list     - プロジェクト一覧を表示");
    process.exit(1);
}
