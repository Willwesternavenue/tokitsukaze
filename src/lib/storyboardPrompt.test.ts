import { describe, it, expect } from "vitest";
import { buildStoryboardPrompt, STORYBOARD_STYLE_SUFFIX } from "@/lib/storyboardPrompt";
import type { SceneMeta, ReferenceCharacterCard } from "@/lib/types";

const meta: SceneMeta = {
  intExt: "INT",
  location: "古い印刷所",
  timeOfDay: "NIGHT",
  purpose: "主人公が父の遺した活版印刷機と対面する",
  presentCharacters: ["ハル"],
};
const body = [
  "○ 古い印刷所（INT・夜）",
  "　埃をかぶった活版印刷機。ハルがゆっくり近づく。",
  "ハル",
  "「まだ、動くのか……」",
].join("\n");
const chars: ReferenceCharacterCard[] = [
  { name: "ハル", voice: "静かで訥々", keyLines: [], facts: ["20代女性", "黒髪のショートヘア", "作業着"] },
];

describe("buildStoryboardPrompt", () => {
  it("sceneMeta の各要素をプロンプトに含める", () => {
    const p = buildStoryboardPrompt({ sceneMeta: meta, body, characters: chars });
    expect(p).toContain("INT");
    expect(p).toContain("古い印刷所");
    expect(p).toContain("NIGHT");
    expect(p).toContain("主人公が父の遺した活版印刷機と対面する");
  });

  it("ト書き（action行）の内容を含める", () => {
    const p = buildStoryboardPrompt({ sceneMeta: meta, body, characters: chars });
    expect(p).toContain("活版印刷機");
  });

  it("登場キャラの設定(facts)を注入する（②テキスト一貫性）", () => {
    const p = buildStoryboardPrompt({ sceneMeta: meta, body, characters: chars });
    expect(p).toContain("ハル");
    expect(p).toContain("黒髪のショートヘア");
  });

  it("スタイル接尾辞を必ず付ける", () => {
    const p = buildStoryboardPrompt({ sceneMeta: meta, body, characters: chars });
    expect(p).toContain(STORYBOARD_STYLE_SUFFIX);
  });

  it("sceneMeta/characters が無くても throw しない", () => {
    expect(() => buildStoryboardPrompt({ body: "" })).not.toThrow();
    const p = buildStoryboardPrompt({ body: "" });
    expect(p).toContain(STORYBOARD_STYLE_SUFFIX);
  });

  it("action行が長い場合は字数上限で切り詰める（AIは呼ばない・決定的）", () => {
    const long = "　" + "あ".repeat(2000);
    const p = buildStoryboardPrompt({ sceneMeta: meta, body: long });
    // 上限 600 + 余白程度に収まる（本文まるごとは載らない）
    expect(p.length).toBeLessThan(1500);
  });
});
