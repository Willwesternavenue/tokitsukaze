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
    genres: ["biography", "novel"],
  },
  {
    promptId: "prompt-outline-business",
    staffLabel: "構成案プランナー（ビジネス書）",
    group: "planning",
    kind: "staff",
    description: "読者課題起点／フレームワーク／ストーリーの3方向で章立てを提案します。",
    runsWhen: "「章立て案を生成する」実行時（ビジネス書モード）",
    genres: ["business"],
  },
  {
    promptId: "prompt-sections",
    staffLabel: "シーン展開担当",
    group: "planning",
    kind: "staff",
    description: "選択した構成案の各章に小見出し／シーンを展開します。",
    runsWhen: "構成案の選択時・小見出し再生成時",
    genres: ["biography", "novel"],
  },
  {
    promptId: "prompt-sections-business",
    staffLabel: "節構成担当（ビジネス書）",
    group: "planning",
    kind: "staff",
    description: "各章に「主張→根拠→事例→まとめ」を意識した節を展開します。",
    runsWhen: "構成案の選択時・節再生成時（ビジネス書モード）",
    genres: ["business"],
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
  {
    promptId: "prompt-relations",
    staffLabel: "相関図アナリスト",
    group: "planning",
    kind: "staff",
    description: "登場人物と素材・本文から人物相関図（関係の向き・ラベル）を抽出します。",
    runsWhen: "人物相関図の「AIで相関図を更新」実行時",
    genres: ["novel"],
  },

  // ===== 執筆スタッフ =====
  {
    promptId: "prompt-draft",
    staffLabel: "本文ライター",
    group: "writing",
    kind: "staff",
    description: "節／シーン単位で本文を執筆します。ナレッジとルールブックを参照します。",
    runsWhen: "「本文を生成」実行時",
    genres: ["biography", "novel"],
  },
  {
    promptId: "prompt-draft-business",
    staffLabel: "本文ライター（ビジネス書）",
    group: "writing",
    kind: "staff",
    description: "「主張→根拠→事例→まとめ」の結論ファースト構造で本文を執筆します。参考文献・用語集を参照します。",
    runsWhen: "「本文を生成」実行時（ビジネス書モード）",
    genres: ["business"],
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
    promptId: "prompt-agent-fact-check",
    staffLabel: "校閲（事実確認）",
    group: "review",
    kind: "staff",
    description:
      "本文中の事実主張を素材・一般知識と照合し、誤り・時代考証の違和感・要出典を検出します。実話ベースの原稿に必須。",
    runsWhen: "本文生成後に自動実行（聞き書き・ビジネス書モード。創作の小説では実行されない）",
    genres: ["biography", "business"],
    agentKey: "fact-check",
  },
  {
    promptId: "prompt-agent-logic",
    staffLabel: "論理構成チェック",
    group: "review",
    kind: "staff",
    description: "主張と根拠の対応、論理の飛躍、循環論法、過度な一般化を検出します。",
    runsWhen: "本文生成後に自動実行（ビジネス書モードのみ）",
    genres: ["business"],
    agentKey: "logic-check",
  },
  {
    promptId: "prompt-agent-citation",
    staffLabel: "出典チェック",
    group: "review",
    kind: "staff",
    description: "出典が必要な主張を検出し、参考文献ナレッジとの紐付け状況を確認します。",
    runsWhen: "本文生成後に自動実行（ビジネス書モードのみ）",
    genres: ["business"],
    agentKey: "citation-check",
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
  { label: "フォーマットチェック", genres: "脚本（柱・ト書き・セリフ）" },
  { label: "尺・テンポチェック", genres: "脚本（映画・ドラマ・舞台）" },
  { label: "手順検証", genres: "実用書" },
  { label: "簡易査読", genres: "論文" },
  { label: "SEOチェック", genres: "ブログ・記事" },
];

/** 検討中・開発予定のモード。設定画面などのロードマップ表示用 */
export const plannedGenres: { label: string; status: "next" | "candidate"; note: string }[] = [
  { label: "脚本", status: "next", note: "ハリウッドスタイルの柱 (INT/EXT)・ト書きベース。尺の管理。映画/ドラマ/舞台対応" },
  { label: "実用書", status: "candidate", note: "ハウツー・手順解説。手順の検証エージェントを検討" },
  { label: "ブログ・記事", status: "candidate", note: "SEO・見出し構成・ファクトチェック" },
  { label: "論文", status: "candidate", note: "IMRaD構成・日英翻訳・簡易査読" },
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
