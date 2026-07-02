import type { AgentKey, Genre } from "./types";

/**
 * StaffRegistry — プロンプトテンプレート(id)を「AIスタッフの役割」として分類する。
 *
 * - kind: "staff"    = 実行される役割 (ステージ担当 or 自動レビュアー)
 * - kind: "rulebook" = 実行されず、他のスタッフの system prompt に注入される編集方針
 *
 * agentKey を持つスタッフは本文生成後に自動実行されるレビュアーで、
 * プロジェクト単位の有効/無効トグル (Project.agentToggles) の対象になる。
 */

export type StaffGroup = "planning" | "writing" | "review" | "risk" | "rulebook";

export const STAFF_GROUP_LABEL: Record<StaffGroup, string> = {
  planning: "企画・構成スタッフ",
  writing: "執筆スタッフ",
  review: "レビュースタッフ",
  risk: "リスク・専門チェック",
  rulebook: "ルールブック",
};

export type StaffMeta = {
  promptId: string;
  staffLabel: string;
  group: StaffGroup;
  kind: "staff" | "rulebook";
  description: string;
  runsWhen: string;
  /** "common" = 全ジャンル / 配列 = 対象ジャンル限定 */
  genres: "common" | Genre[];
  /** 自動レビュアーのみ。トグル対象 */
  agentKey?: AgentKey;
};

export const staffRegistry: StaffMeta[] = [
  // ===== 企画・構成スタッフ =====
  {
    promptId: "prompt-outline",
    staffLabel: "構成案プランナー",
    group: "planning",
    kind: "staff",
    description: "素材から章立て・構成案を3案提案します。",
    runsWhen: "「章立て案を生成する」実行時",
    genres: "common",
  },
  {
    promptId: "prompt-sections",
    staffLabel: "シーン展開担当",
    group: "planning",
    kind: "staff",
    description: "選択した構成案の各章に小見出し／シーンを展開します。",
    runsWhen: "構成案の選択時・小見出し再生成時",
    genres: "common",
  },
  {
    promptId: "prompt-followup",
    staffLabel: "追加質問プランナー",
    group: "planning",
    kind: "staff",
    description: "素材の不足箇所から、次回取材で聞くべき質問を作成します。",
    runsWhen: "（手動実行・将来対応）",
    genres: ["biography"],
  },

  // ===== 執筆スタッフ =====
  {
    promptId: "prompt-draft",
    staffLabel: "本文ライター",
    group: "writing",
    kind: "staff",
    description: "節／シーン単位で本文を執筆します。ナレッジとルールブックを参照します。",
    runsWhen: "「本文を生成」実行時",
    genres: "common",
  },

  // ===== レビュースタッフ =====
  {
    promptId: "prompt-review",
    staffLabel: "編集レビュー担当",
    group: "review",
    kind: "staff",
    description: "編集長視点のレビューを既存の編集メモに追記します。",
    runsWhen: "「編集レビューを追加」実行時（手動）",
    genres: "common",
  },
  {
    promptId: "prompt-agent-proofreader",
    staffLabel: "校正",
    group: "review",
    kind: "staff",
    description: "用字用語・てにをは・句読点・誤字脱字を検出します。",
    runsWhen: "本文生成後に自動実行",
    genres: "common",
    agentKey: "proofreader",
  },
  {
    promptId: "prompt-agent-style-guardian",
    staffLabel: "文体守護",
    group: "review",
    kind: "staff",
    description: "ですます／である調の混在、語尾の単調、美談化を検出します。",
    runsWhen: "本文生成後に自動実行",
    genres: "common",
    agentKey: "style-guardian",
  },
  {
    promptId: "prompt-agent-consistency-lite",
    staffLabel: "整合性チェック",
    group: "review",
    kind: "staff",
    description: "執筆メモリ・年表・既存章との矛盾を検出します。",
    runsWhen: "本文生成後に自動実行",
    genres: "common",
    agentKey: "consistency-lite",
  },
  {
    promptId: "prompt-agent-reader-experience",
    staffLabel: "読者体験レビュー",
    group: "review",
    kind: "staff",
    description: "退屈な箇所、引きの弱さ、感情移入の弱さを読者視点で検出します。",
    runsWhen: "本文生成後に自動実行",
    genres: "common",
    agentKey: "reader-experience",
  },
  {
    promptId: "prompt-agent-character-voice",
    staffLabel: "キャラクター整合性",
    group: "review",
    kind: "staff",
    description: "登場人物の口調・欲望・アークとの一貫性を検証します。",
    runsWhen: "本文生成後に自動実行（小説モードのみ）",
    genres: ["novel"],
    agentKey: "character-voice",
  },
  {
    promptId: "prompt-agent-tension",
    staffLabel: "緊張感チェック",
    group: "review",
    kind: "staff",
    description: "葛藤・障害・不穏さの持続と、読者の期待の維持を検証します。",
    runsWhen: "本文生成後に自動実行（小説モードのみ）",
    genres: ["novel"],
    agentKey: "tension-checker",
  },

  // ===== ルールブック =====
  {
    promptId: "prompt-style-rules",
    staffLabel: "校正・編集ルール",
    group: "rulebook",
    kind: "rulebook",
    description:
      "文体・てにをは・禁則・用字用語の共通スタイルガイド（共同通信・朝日新聞準拠）。",
    runsWhen: "本文ライターと編集レビュー担当に自動注入",
    genres: "common",
  },
];

/** 将来のリスク・専門チェック（P4以降）。UI 上のロードマップ表示用 */
export const plannedRiskStaff: { label: string; genres: string }[] = [
  { label: "プライバシーリスク", genres: "小説（実話ベース）" },
  { label: "名誉毀損リスク", genres: "小説（実話ベース）" },
  { label: "出典チェック", genres: "ビジネス書" },
  { label: "簡易査読", genres: "論文" },
  { label: "SEOチェック", genres: "ブログ・記事" },
];

export function staffForGenre(genre: Genre): StaffMeta[] {
  return staffRegistry.filter(
    (s) => s.genres === "common" || (Array.isArray(s.genres) && s.genres.includes(genre)),
  );
}

export function findStaffByPromptId(promptId: string): StaffMeta | undefined {
  return staffRegistry.find((s) => s.promptId === promptId);
}

/** AgentKey → 表示ラベル（レビュー画面などで使用） */
export function agentLabel(agentKey: string): string {
  const meta = staffRegistry.find((s) => s.agentKey === agentKey);
  return meta?.staffLabel ?? agentKey;
}
