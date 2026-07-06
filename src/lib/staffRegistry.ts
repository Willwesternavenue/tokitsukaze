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
    promptId: "prompt-outline-screenplay",
    staffLabel: "構成案プランナー（脚本）",
    group: "planning",
    kind: "staff",
    description: "三幕構成／シークエンス／群像・ノンリニアの3方向で幕構成を提案します。目標尺に合わせて配分します。",
    runsWhen: "「章立て案を生成する」実行時（脚本モード）",
    genres: ["screenplay"],
  },
  {
    promptId: "prompt-sections-screenplay",
    staffLabel: "ハコ書き担当（脚本）",
    group: "planning",
    kind: "staff",
    description: "各幕にシーンを展開し、slugline (INT/EXT・場所・時間帯) と想定尺を割り当てます。",
    runsWhen: "構成案の選択時・シーン再生成時（脚本モード）",
    genres: ["screenplay"],
  },
  {
    promptId: "prompt-outline-blog",
    staffLabel: "構成案プランナー（ブログ）",
    group: "planning",
    kind: "staff",
    description: "ハウツー／比較まとめ／体験オピニオンの3方向で見出し構成を提案します。検索意図をカバーします。",
    runsWhen: "「章立て案を生成する」実行時（ブログ記事モード）",
    genres: ["blog"],
  },
  {
    promptId: "prompt-sections-blog",
    staffLabel: "見出し構成担当（ブログ）",
    group: "planning",
    kind: "staff",
    description: "各ブロックに H2/H3 相当の小見出しを展開します。読者の連続した問いをカバーします。",
    runsWhen: "構成案の選択時・見出し再生成時（ブログ記事モード）",
    genres: ["blog"],
  },
  {
    promptId: "prompt-outline-news",
    staffLabel: "構成案プランナー（ニュース）",
    group: "planning",
    kind: "staff",
    description: "逆ピラミッド／解説Q&A／ルポ・特集の3方向で記事構成を提案します。5W1Hの充足を確認します。",
    runsWhen: "「章立て案を生成する」実行時（ニュース記事モード）",
    genres: ["news"],
  },
  {
    promptId: "prompt-sections-news",
    staffLabel: "見出し構成担当（ニュース）",
    group: "planning",
    kind: "staff",
    description: "各ブロックに小見出しを展開します。重要な事実から順に配置します。",
    runsWhen: "構成案の選択時・見出し再生成時（ニュース記事モード）",
    genres: ["news"],
  },
  {
    promptId: "prompt-terms-extract",
    staffLabel: "用語アナリスト（翻訳）",
    group: "planning",
    kind: "staff",
    description: "翻訳済みセグメントの原文・訳文ペアから対訳表の候補（用語・固有名詞・訳語）を抽出します。",
    runsWhen: "対訳表画面の「AIで用語を抽出」実行時（翻訳書モード）",
    genres: ["translation"],
  },
  {
    promptId: "prompt-interview-questions",
    staffLabel: "事前ヒアリング担当",
    group: "planning",
    kind: "staff",
    description: "章立て生成の前に、著者へ確認する質問（3〜10問）を作成します。回答は素材に反映されます。",
    runsWhen: "「章立て案を生成する」→ 事前ヒアリング画面で実行",
    genres: "common",
  },
  {
    promptId: "prompt-refine-outline",
    staffLabel: "構成リファイナー",
    group: "planning",
    kind: "staff",
    description: "選択した構成案を指示に沿って改善します（全体改善・章ごとの部分修正）。",
    runsWhen: "構成の調整画面で「AIで改善」実行時",
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

  {
    promptId: "prompt-draft-screenplay",
    staffLabel: "脚本ライター",
    group: "writing",
    kind: "staff",
    description: "柱・ト書き・セリフの形式でシーン本文を執筆します。ト書きは視覚・聴覚情報のみ。",
    runsWhen: "「本文を生成」実行時（脚本モード）",
    genres: ["screenplay"],
  },

  {
    promptId: "prompt-draft-blog",
    staffLabel: "本文ライター（ブログ）",
    group: "writing",
    kind: "staff",
    description: "結論先出し・視点入り・SEO配慮の本文を執筆します。アンチAIスロップ規則に従います。",
    runsWhen: "「本文を生成」実行時（ブログ記事モード）",
    genres: ["blog"],
  },

  {
    promptId: "prompt-draft-news",
    staffLabel: "記者（ニュース）",
    group: "writing",
    kind: "staff",
    description: "リード先行・5W1H・事実と論評の分離・出典明示の規律で記事本文を執筆します。",
    runsWhen: "「本文を生成」実行時（ニュース記事モード）",
    genres: ["news"],
  },
  {
    promptId: "prompt-draft-translation",
    staffLabel: "翻訳者",
    group: "writing",
    kind: "staff",
    description:
      "原文セグメントを対訳表・文体方針に従って翻訳します。原文種別（書籍/論文/創作/記事）で規律が切り替わります。",
    runsWhen: "「このセグメントを翻訳」実行時（翻訳書モード）",
    genres: ["translation"],
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
    runsWhen: "本文生成後に自動実行（聞き書き・ビジネス書・ブログ・ニュース。創作の小説では実行されない）",
    genres: ["biography", "business", "blog", "news"],
    agentKey: "fact-check",
  },
  {
    promptId: "prompt-agent-headline-lead",
    staffLabel: "見出し・リード整合チェック",
    group: "review",
    kind: "staff",
    description:
      "見出しと本文の乖離（見出し詐欺）、リードの5W1H欠落、重要情報の後置を検出し、見出し案を提示します。",
    runsWhen: "本文生成後に自動実行（ニュース記事モードのみ）",
    genres: ["news"],
    agentKey: "headline-lead-check",
  },
  {
    promptId: "prompt-agent-neutrality",
    staffLabel: "中立性・両論チェック",
    group: "review",
    kind: "staff",
    description:
      "出典なき評価・断定、ロード語（印象操作的な形容）、一方の言い分のみの記述、事実と論評の混在を検出します。",
    runsWhen: "本文生成後に自動実行（ニュース記事モードのみ）",
    genres: ["news"],
    agentKey: "neutrality-check",
  },
  {
    promptId: "prompt-agent-omission",
    staffLabel: "訳抜け・過剰訳チェック",
    group: "review",
    kind: "staff",
    description:
      "原文と訳文を突き合わせ、訳抜け（文・句・修飾・否定の欠落）、原文にない加筆、数値・固有名詞の転記ミスを検出します。",
    runsWhen: "翻訳生成後に自動実行（翻訳書モード。論文モードでも流用予定）",
    genres: ["translation"],
    agentKey: "omission-check",
  },
  {
    promptId: "prompt-agent-terminology",
    staffLabel: "用語統一チェック",
    group: "review",
    kind: "staff",
    description:
      "対訳表と突き合わせ、確定訳語と異なる訳・同一原語の訳し分け（意図しないもの）を検出します。",
    runsWhen: "翻訳生成後に自動実行（翻訳書モード。論文モードでも流用予定）",
    genres: ["translation"],
    agentKey: "terminology-check",
  },
  {
    promptId: "prompt-agent-orthography",
    staffLabel: "表記揺れチェック",
    group: "review",
    kind: "staff",
    description:
      "カタカナ長音（サーバ/サーバー）、漢字/かなの揺れ（下さい/ください）、数字・単位表記の揺れを検出します。",
    runsWhen: "翻訳生成後に自動実行（翻訳書モード）",
    genres: ["translation"],
    agentKey: "orthography-check",
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
    runsWhen: "本文生成後に自動実行（小説・脚本モード）",
    genres: ["novel", "screenplay"],
    agentKey: "character-voice",
  },
  {
    promptId: "prompt-agent-tension",
    staffLabel: "緊張感チェック",
    group: "review",
    kind: "staff",
    description: "葛藤・障害・不穏さの持続と、読者の期待の維持を検証します。",
    runsWhen: "本文生成後に自動実行（小説・脚本モード）",
    genres: ["novel", "screenplay"],
    agentKey: "tension-checker",
  },

  {
    promptId: "prompt-agent-screenplay-format",
    staffLabel: "フォーマットチェック",
    group: "review",
    kind: "staff",
    description: "柱・ト書き・セリフの形式準拠を検証。ト書きへの内面描写の混入を検出します。",
    runsWhen: "本文生成後に自動実行（脚本モードのみ）",
    genres: ["screenplay"],
    agentKey: "format-check",
  },
  {
    promptId: "prompt-agent-runtime",
    staffLabel: "尺・テンポチェック",
    group: "review",
    kind: "staff",
    description: "想定尺と本文分量の乖離、テンポの停滞、シーンの存在理由の弱さを検出します。",
    runsWhen: "本文生成後に自動実行（脚本モードのみ）",
    genres: ["screenplay"],
    agentKey: "runtime-check",
  },

  {
    promptId: "prompt-agent-seo",
    staffLabel: "SEO・検索意図チェック",
    group: "review",
    kind: "staff",
    description: "検索意図の充足・見出し・キーワードの扱い・薄い内容を検証し、メタディスクリプション案を提示します。",
    runsWhen: "本文生成後に自動実行（ブログ記事モードのみ）",
    genres: ["blog"],
    agentKey: "seo-check",
  },

  {
    promptId: "prompt-agent-repetition",
    staffLabel: "重複チェック（過去作品）",
    group: "review",
    kind: "staff",
    description: "参照ライブラリの過去作品と照合し、既に述べた主張・エピソードの再掲を検出します。",
    runsWhen: "本文生成後に自動実行（参照作品を1件以上選択している時のみ・全ジャンル）",
    genres: "common",
    agentKey: "repetition-check",
  },
  {
    promptId: "prompt-agent-continuity",
    staffLabel: "一貫性チェック（過去作品）",
    group: "review",
    kind: "staff",
    description: "参照ライブラリの確定設定・キャラの口調/過去セリフと照合し、矛盾を検出します。続編に有効。",
    runsWhen: "本文生成後に自動実行（参照作品を1件以上選択している時のみ・全ジャンル）",
    genres: "common",
    agentKey: "continuity-check",
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
  { label: "手順検証", genres: "実用書" },
  { label: "簡易査読", genres: "論文" },
];

/** 検討中・開発予定のモード。設定画面などのロードマップ表示用 */
export const plannedGenres: { label: string; status: "next" | "candidate"; note: string }[] = [
  { label: "実用書", status: "candidate", note: "ハウツー・手順解説。手順の検証エージェントを検討" },
  {
    label: "論文",
    status: "candidate",
    note: "IMRaD構成・簡易査読。日英翻訳は翻訳書モードのエンジン（翻訳者・訳抜け/用語統一チェック・対訳表）を流用予定",
  },
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
