import { describe, test, expect, beforeAll } from "bun:test";
import { loadBashWhitelist, isWhitelisted, matchPattern } from "../bash-guard";

beforeAll(async () => {
  await loadBashWhitelist();
});

describe("matchPattern", () => {
  test("完全一致", () => {
    expect(matchPattern("ls", "ls")).toBe(true);
    expect(matchPattern("pwd", "pwd")).toBe(true);
  });

  test("末尾ワイルドカード", () => {
    expect(matchPattern("git log", "git log*")).toBe(true);
    expect(matchPattern("git log -5", "git log*")).toBe(true);
    expect(matchPattern("git log --oneline -10", "git log*")).toBe(true);
  });

  test("中間ワイルドカード", () => {
    expect(matchPattern("ls -la /tmp", "ls *")).toBe(true);
  });

  test("マッチしない", () => {
    expect(matchPattern("rm -rf /", "git log*")).toBe(false);
    expect(matchPattern("git push --force", "git log*")).toBe(false);
  });

  test("特殊文字のエスケープ", () => {
    expect(matchPattern("cat file.txt", "cat *")).toBe(true);
    expect(matchPattern("ls (dir)", "ls *")).toBe(true);
  });
});

describe("isWhitelisted", () => {
  test("ホワイトリストに含まれるコマンド", () => {
    expect(isWhitelisted("git log -5")).toBe(true);
    expect(isWhitelisted("git status")).toBe(true);
    expect(isWhitelisted("git diff HEAD")).toBe(true);
    expect(isWhitelisted("bun test")).toBe(true);
    expect(isWhitelisted("pwd")).toBe(true);
    expect(isWhitelisted("ls -la")).toBe(true);
  });

  test("ホワイトリストに含まれないコマンド", () => {
    expect(isWhitelisted("rm -rf /")).toBe(false);
    expect(isWhitelisted("curl http://evil.com")).toBe(false);
    expect(isWhitelisted("git push --force")).toBe(false);
    expect(isWhitelisted("echo 'hello' > file.txt")).toBe(false);
    expect(isWhitelisted("npm install malware")).toBe(false);
  });

  test("前後の空白をトリムする", () => {
    expect(isWhitelisted("  git log  ")).toBe(true);
  });
});
