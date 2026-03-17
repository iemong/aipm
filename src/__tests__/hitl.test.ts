import { describe, test, expect } from "bun:test";
import {
  parseHitlFromResult,
  buildHitlBlocks,
  waitForHitl,
  resolvePendingHitl,
  buildFreeformModal,
  type HitlRequest,
} from "../hitl";

describe("parseHitlFromResult", () => {
  test("HITLマーカーがない場合はnullを返す", () => {
    const { hitl, cleanText } = parseHitlFromResult("通常の応答です。");
    expect(hitl).toBeNull();
    expect(cleanText).toBe("通常の応答です。");
  });

  test("HITLマーカーをパースする", () => {
    const text = `確認です。\n:::HITL:::\n{"question":"登録しますか？","type":"confirm","options":["はい","いいえ"],"context":"背景"}\n:::END_HITL:::`;
    const { hitl, cleanText } = parseHitlFromResult(text);
    expect(hitl).not.toBeNull();
    expect(hitl!.question).toBe("登録しますか？");
    expect(hitl!.type).toBe("confirm");
    expect(hitl!.options).toEqual(["はい", "いいえ"]);
    expect(hitl!.context).toBe("背景");
    expect(cleanText).toBe("確認です。");
  });

  test("不正なJSONの場合はnullを返す", () => {
    const text = ":::HITL:::\n{bad}\n:::END_HITL:::";
    const { hitl, cleanText } = parseHitlFromResult(text);
    expect(hitl).toBeNull();
    expect(cleanText).toBe(text);
  });

  test("HITLマーカーのみの場合cleanTextは空文字", () => {
    const text = ':::HITL:::\n{"question":"Q","type":"confirm"}\n:::END_HITL:::';
    const { hitl, cleanText } = parseHitlFromResult(text);
    expect(hitl).not.toBeNull();
    expect(cleanText).toBe("");
  });
});

describe("buildHitlBlocks", () => {
  test("confirmタイプで4ボタンを生成する", () => {
    const hitl: HitlRequest = { question: "Q?", type: "confirm" };
    const blocks = buildHitlBlocks("r1", hitl);
    // section + actions (no context)
    expect(blocks.length).toBe(2);
    const actions = blocks[1] as any;
    expect(actions.elements.length).toBe(4);
    expect(actions.elements[0].action_id).toBe("hitl:yes:r1");
    expect(actions.elements[1].action_id).toBe("hitl:no:r1");
    expect(actions.elements[2].action_id).toBe("hitl:yes_but:r1");
    expect(actions.elements[3].action_id).toBe("hitl:freeform:r1");
  });

  test("contextがある場合はcontextブロックを追加する", () => {
    const hitl: HitlRequest = { question: "Q?", type: "confirm", context: "bg" };
    const blocks = buildHitlBlocks("r2", hitl);
    expect(blocks.length).toBe(3);
    expect(blocks[1].type).toBe("context");
  });

  test("choiceタイプで選択肢ボタンを生成する", () => {
    const hitl: HitlRequest = { question: "Q?", type: "choice", options: ["A", "B"] };
    const blocks = buildHitlBlocks("r3", hitl);
    const actions = blocks[1] as any;
    expect(actions.elements.length).toBe(2);
    expect(actions.elements[0].value).toBe("A");
    expect(actions.elements[1].action_id).toBe("hitl:choice:r3:1");
  });

  test("freeformタイプでも4ボタンを生成する", () => {
    const hitl: HitlRequest = { question: "Q?", type: "freeform" };
    const blocks = buildHitlBlocks("r4", hitl);
    const actions = blocks[1] as any;
    expect(actions.elements.length).toBe(4);
  });
});

describe("waitForHitl / resolvePendingHitl", () => {
  test("解決する", async () => {
    const p = waitForHitl("w1", 5000);
    setTimeout(() => resolvePendingHitl("w1", "はい"), 10);
    expect(await p).toBe("はい");
  });

  test("タイムアウト", async () => {
    const answer = await waitForHitl("w2", 30);
    expect(answer).toContain("タイムアウト");
  });

  test("存在しないIDはfalse", () => {
    expect(resolvePendingHitl("none", "x")).toBe(false);
  });
});

describe("buildFreeformModal", () => {
  test("モーダルを生成する", () => {
    const m = buildFreeformModal("m1", "条件付き");
    expect(m.type).toBe("modal");
    expect(m.callback_id).toBe("hitl_modal:m1");
  });

  test("タイトルを24文字に切り詰める", () => {
    const m = buildFreeformModal("m2", "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふ");
    expect((m.title as any).text.length).toBeLessThanOrEqual(24);
  });
});
