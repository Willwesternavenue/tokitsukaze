import type { Genre } from "./types";

/**
 * GenreConfig — ジャンル＝パイプラインのプリセット。
 *
 * 設計原則:
 *   - ナビの骨格 (01素材 → 02構成 → 03執筆 → 04レビュー) は全ジャンル固定
 *   - 各ステージのラベル・説明・ナレッジ項目・placeholder はジャンルで差し替える
 *   - 新ジャンル追加 = ここに config を足す + プロンプトを足す（画面コードは触らない）
 *
 * 概念の3分類 (混ぜないこと):
 *   - AIスタッフ    = 実行される役割 (staffRegistry.ts)
 *   - ナレッジ      = 参照される材料 (このファイルの knowledge)
 *   - ルールブック  = 各スタッフに注入される編集方針 (staffRegistry の kind:"rulebook")
 */

export type StageKey = "material" | "structure" | "writing" | "review";

export type StageConfig = {
  navLabel: string;   // ナビ表示 (素材 / 構成 / 執筆 / レビュー)
  pageTitle: string;  // 画面タイトル
  description: string; // 画面サブタイトル
};

export type KnowledgeItem = {
  href: string;
  label: string;
};

export type GenreConfig = {
  genre: Genre;
  label: string;
  stages: Record<StageKey, StageConfig>;
  knowledge: KnowledgeItem[];
  material: {
    panelTitle: string;
    placeholder: string;
    help: string;
    subjectLabel: string; // 「取材対象者名」/「主人公名」
  };
};

export const biographyConfig: GenreConfig = {
  genre: "biography",
  label: "聞き書き",
  stages: {
    material: {
      navLabel: "素材",
      pageTitle: "取材メモ入力",
      description: "取材で聞いた内容を貼り付け、章立て案を生成します。",
    },
    structure: {
      navLabel: "構成",
      pageTitle: "章立て構成案",
      description: "AIが提示した構成案から方向性を選びます。",
    },
    writing: {
      navLabel: "執筆",
      pageTitle: "原稿生成",
      description: "選択した構成案をもとに、小見出し単位で本文を生成します。",
    },
    review: {
      navLabel: "レビュー",
      pageTitle: "編集レビュー",
      description: "AI編集部の診断結果を集約して確認します。",
    },
  },
  knowledge: [{ href: "/memory", label: "執筆メモリ" }],
  material: {
    panelTitle: "取材メモ",
    placeholder: "取材で聞き取った内容を、箇条書き／自由記述どちらでも貼り付けてください。",
    help: "事実関係のみで構いません。整形・要約はAIが行います。個人を特定する情報は事前にマスキングしてください。長さの目安は 20,000 字以内。40,000 字を超えるとサーバタイムアウト（最大 180 秒）に達する可能性があります。",
    subjectLabel: "取材対象者名",
  },
};

export const novelConfig: GenreConfig = {
  genre: "novel",
  label: "小説",
  stages: {
    material: {
      navLabel: "素材",
      pageTitle: "プロット素材",
      description: "基本プロット、場面案、キャラクターの種を整理し、章立て案を生成します。",
    },
    structure: {
      navLabel: "構成",
      pageTitle: "章・シーン構成",
      description: "物語を章とシーンに分解します。",
    },
    writing: {
      navLabel: "執筆",
      pageTitle: "本文執筆",
      description: "シーン単位で本文を生成・編集します。",
    },
    review: {
      navLabel: "レビュー",
      pageTitle: "読者体験・整合性レビュー",
      description: "退屈さ、感情移入、キャラの一貫性、矛盾を確認します。",
    },
  },
  knowledge: [
    { href: "/characters", label: "登場人物" },
    { href: "/bible", label: "Story Bible" },
    { href: "/memory", label: "執筆メモリ" },
  ],
  material: {
    panelTitle: "プロット / 素材メモ",
    placeholder:
      "物語のあらすじ、書きたいシーン、主人公の背景、対立構造、テーマなどを自由に入力してください。取材や実話ベースの素材でも構いません。",
    help: "プロット・設定・シーン案などをまとめて投入できます。この内容と、ナレッジ（登場人物 / Story Bible）に登録した情報を合わせて AI が章立て → 本文を組み立てます。",
    subjectLabel: "主人公名 / モデル",
  },
};

const registry: Record<Genre, GenreConfig> = {
  biography: biographyConfig,
  novel: novelConfig,
};

export function getGenreConfig(genre: Genre | undefined | null): GenreConfig {
  return registry[genre ?? "biography"] ?? biographyConfig;
}

export const allGenres: GenreConfig[] = Object.values(registry);
