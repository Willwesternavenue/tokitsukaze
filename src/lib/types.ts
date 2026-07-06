export type Section = {
  id: string;
  title: string;
  summary?: string;
  /** 脚本モード: シーンの slugline・尺・目的 (他ジャンルでは undefined) */
  sceneMeta?: SceneMeta;
  /** 翻訳書モード: このセグメントの原文 (他ジャンルでは undefined) */
  sourceText?: string;
};

export type Chapter = {
  id: string;
  chapterNumber: number;
  title: string;
  summary: string;
  sections: Section[];
};

export type OutlineType = "chronological" | "thematic" | "narrative";

export type OutlineProposal = {
  id: string;
  title: string;
  type: OutlineType;
  concept: string;
  recommendedFor: string;
  chapters: Chapter[];
};

export type SectionDraft = {
  id: string;
  chapterId: string;
  sectionId: string;
  chapterTitle: string;
  sectionTitle: string;
  body: string;
  editorNotes: string[];
  followUpQuestions: string[];
  factCheckPoints: string[];
  continuityNotes: string[];
  createdAt: string;
  updatedAt: string;
  /** 波及再生成から保護するフラグ（本文を手で直した節） */
  locked?: boolean;
  /** 翻訳書モード: 過去の訳文（再生成・手動編集の前に退避。Diff比較の材料。最大10版） */
  bodyHistory?: BodyVersion[];
};

/** 訳文（本文）の過去バージョン。GitHub風Diffの比較元になる */
export type BodyVersion = {
  savedAt: string;
  body: string;
  note?: string; // "再生成前" | "手動編集前" | "一括置換前" 等
};

// 影響検出（波及反映）: 上流の編集で影響を受ける下流の節
export type ImpactItem = {
  chapterId: string;
  sectionId: string;
  chapterTitle: string;
  sectionTitle: string;
  reason: string;   // なぜ影響を受けるか
  severity: "high" | "low";
};

export type WritingMemory = {
  profile: {
    name: string;
    age: string;
    occupation: string;
    location: string;
    personality: string[];
    keyPhrases: string[];
  };
  bookConcept: {
    mainTheme: string;
    targetReader: string;
    tone: string;
    avoidExpressions: string[];
  };
  timeline: {
    period: string;
    event: string;
    notes: string;
  }[];
  confirmedFacts: string[];
  uncertainFacts: string[];
  styleRules: string[];
  selectedOutlineSummary: string;
  chapterSummaries: {
    chapterTitle: string;
    summary: string;
  }[];
};

export type PromptTemplate = {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  userPromptTemplate: string;
  outputFormat: string;
};

export type Project = {
  id: string;
  name: string;
  intervieweeName: string;
  theme: string;
  targetReader: string;
  desiredTone: string;
  interviewNotes: string;
  outlineProposals: OutlineProposal[];
  selectedOutline?: OutlineProposal;
  writingMemory: WritingMemory;
  generatedSections: SectionDraft[];
  createdAt: string;
  updatedAt: string;
  // ===== P3: Novel-specific =====
  genre: Genre;
  characters: NovelCharacter[];
  storyBible: StoryBible;
  // ===== ビジネス書 =====
  references: Reference[];
  glossary: GlossaryTerm[];
  // ===== 脚本 =====
  screenplayMeta?: ScreenplayMeta;
  // ===== ブログ記事 =====
  blogMeta?: BlogMeta;
  // ===== ニュース記事 =====
  newsMeta?: NewsMeta;
  // ===== 翻訳書 =====
  translationMeta?: TranslationMeta;
  /** 翻訳書: 対訳表（用語の確定訳語と揺れ表記）。論文モードでも流用予定 */
  termPairs?: TermPair[];
  /** 翻訳書: 参照するグローバル対訳表のID（本体はグローバル localStorage） */
  termSetIds?: string[];
  // ===== 参照ライブラリ（このプロジェクトが参照する作品のID。ライブラリ本体はグローバル）=====
  referenceWorkIds?: string[];
  // ===== Nav 再構成: AIスタッフのトグルと診断結果の永続化 =====
  /** 自動レビュアーの有効/無効。未設定キーは有効扱い */
  agentToggles?: Partial<Record<AgentKey, boolean>>;
  /** "chapterId::sectionId" → 直近の診断結果。/review 画面の集約元 */
  sectionAgentReports?: Record<string, AgentReportSummary[]>;
  /** 上と同じキー → ひとつ前の診断結果。再生成後の「解決済み」判定に使う */
  sectionAgentReportsPrev?: Record<string, AgentReportSummary[]>;
};

export type ReviewResult = {
  editorNotes: string[];
  followUpQuestions: string[];
  factCheckPoints: string[];
  revisionSuggestions: string[];
};

// ===== P2: Multi-agent review =====

export type AgentKey =
  | "proofreader"
  | "style-guardian"
  | "consistency-lite"
  | "reader-experience"
  // P3: novel-only agents
  | "character-voice"
  | "tension-checker"
  // 聞き書き・ビジネス書用の事実確認
  | "fact-check"
  // ビジネス書専用
  | "logic-check"
  | "citation-check"
  // 脚本専用
  | "format-check"
  | "runtime-check"
  // ブログ記事専用
  | "seo-check"
  // ニュース記事専用
  | "headline-lead-check"
  | "neutrality-check"
  // 翻訳書専用（論文モードでも流用予定）
  | "omission-check"
  | "terminology-check"
  | "orthography-check"
  // 参照ライブラリ（全ジャンル・参照作品選択時のみ）
  | "repetition-check"
  | "continuity-check";

export type AgentSeverity = "info" | "warning" | "error";

export type AgentFinding = {
  severity: AgentSeverity;
  message: string;
  loc?: string; // 該当箇所の一部を引用 (10〜30字)
};

export type AgentReportSummary = {
  agent: AgentKey;
  label: string;
  findings: AgentFinding[];
  meta: {
    model: string;
    runId: string;
    parseFailed?: boolean;
  };
};

// ===== P3: Novel-specific data model =====

export type Genre =
  | "biography"
  | "novel"
  | "business"
  | "screenplay"
  | "blog"
  | "news"
  | "translation";

// ===== ブログ記事モード =====

export type BlogMeta = {
  targetKeyword: string;      // 対策キーワード
  secondaryKeywords: string[]; // 関連キーワード
  searchIntent: string;       // 検索意図（読者がこの検索で本当に知りたいこと）
  persona: string;            // 想定読者の像
  metaDescription: string;    // メタディスクリプション（AIが提案・編集可）
};

// ===== ニュース記事モード =====

export type NewsType = "straight" | "explainer" | "feature" | "interview";

export type NewsMeta = {
  outlet: string;        // 想定媒体（新聞・Webメディア名）
  newsType: NewsType;    // ストレート / 解説 / 特集・ルポ / インタビュー
  angle: string;         // 切り口・アングル（この記事は何のニュースか）
  audience: string;      // 想定読者
  headlineDraft: string; // 見出し案（AIが提案・編集可）
};

// ===== 翻訳書モード =====

/**
 * 対応言語。当面は日英のみ。
 * 将来 "es" | "zh" | "ko" | "fr" | "de" 等をここに足す（UI は LANGUAGE_OPTIONS が拾う）。
 */
export type LangCode = "ja" | "en";

/** 原文の性質。プロンプトの規律が切り替わる。paper が将来の論文モードへの入口 */
export type TranslationWorkType = "book" | "paper" | "fiction" | "article";

export type TranslationMeta = {
  sourceLang: LangCode;
  targetLang: LangCode;
  workType: TranslationWorkType;
  /** 訳文の文体方針（ですます/である、直訳寄り/意訳寄り、敬称・呼称の扱い等の自由記述） */
  stylePolicy: string;
  sourceFilename?: string;
  sourceCharCount?: number;
};

/**
 * 対訳表の1行。terminology-check（用語統一）と表記揺れスキャンの参照元。
 * - variants: 「この表記に揺れやすい」という検出対象（例: target=サーバー, variants=[サーバ]）
 * - status: AI抽出直後は candidate。人が確認したら confirmed
 */
export type TermPair = {
  id: string;
  source: string;
  target: string;
  variants: string[];
  notes?: string;
  status: "confirmed" | "candidate";
};

/**
 * グローバル対訳表（プロジェクト横断の用語セット）。
 * 参照ライブラリと同じパターン: 本体はグローバル localStorage、プロジェクトは
 * Project.termSetIds で参照する。シリーズ物の翻訳や、論文モードでの分野術語集の
 * 使い回しを想定。同じ原語がある場合はプロジェクト固有の定義が優先される。
 */
export type TermSet = {
  id: string;
  name: string;
  description?: string;
  terms: TermPair[];
  createdAt: string;
  updatedAt: string;
};

// ===== 参照ライブラリ（過去作品・参照作品の「作品カルテ」）=====

export type ReferenceCharacterCard = {
  name: string;
  voice: string;       // 口調・語尾の特徴
  keyLines: string[];  // 過去の重要セリフ（矛盾チェック用）
  facts: string[];     // 設定・経歴
};

export type ReferenceWork = {
  id: string;
  title: string;
  kind: "own" | "reference";   // 自作 / 参照作品
  sourceFilename?: string;
  addedAt: string;
  charCount?: number;
  summary: string;
  styleProfile: string;        // 文体プロファイル（トーン・リズム・語彙・癖）
  keyClaims: string[];         // 既出の主張・トピック（重複回避用）
  canonFacts: string[];        // 確定設定（矛盾防止用）
  characters?: ReferenceCharacterCard[]; // 小説・脚本のみ
};

// ===== 脚本モード =====

export type ScreenplayMediaType = "film" | "short" | "tv-drama" | "stage";

/**
 * シーンの構造化データ（Hollywood slugline 準拠）。
 * 表記はハイブリッド式「○ 印刷所・作業場（INT・夜）」で本文に出力されるが、
 * データはこの構造で保持し、尺ゲージ・フォーマットチェックの参照元になる。
 */
export type SceneMeta = {
  intExt: "INT" | "EXT" | "INT/EXT";
  location: string;
  timeOfDay: "DAY" | "NIGHT" | "DAWN" | "DUSK" | "CONTINUOUS";
  estimatedMinutes?: number;    // 想定尺（分）
  presentCharacters?: string[]; // 登場キャラ名
  purpose?: string;             // このシーンの存在理由（何を前進させるか）
};

export type ScreenplayMeta = {
  mediaType: ScreenplayMediaType;
  targetRuntimeMinutes: number; // 映画=110, 短編=15, ドラマ=45, 舞台=120 等
};

// ===== ビジネス書: 参考文献・用語集 =====

export type Reference = {
  id: string;
  title: string;
  author?: string;
  source?: string;   // 出版社・掲載誌・サイト名
  year?: string;
  url?: string;
  notes?: string;    // どの主張の裏付けに使うか等
};

export type GlossaryTerm = {
  id: string;
  term: string;
  definition: string;
};

export type CharacterRole = "protagonist" | "antagonist" | "supporting" | "minor";

export type CharacterArc = {
  start: string;         // 物語開始時の状態
  turningPoint?: string; // 転機
  end?: string;          // 物語終了時の状態
};

export type NovelCharacter = {
  id: string;
  name: string;
  nameReadings?: string;
  role: CharacterRole;
  profile: string;         // 客観プロフィール
  desire: string;          // 表面的に欲しいもの (want)
  need: string;            // 本当に必要なもの (need)
  wound?: string;          // 過去の傷
  contradiction?: string;  // 矛盾・弱点
  voice: string;           // 口調・語尾・話し方の特徴
  tabooWords: string[];    // この人物は絶対言わない語
  arc?: CharacterArc;
  notes?: string;
};

export type WorldRule = {
  id: string;
  category: string;   // "魔法" | "身分制度" | "地理" | "経済" 等
  rule: string;
  exceptions?: string;
};

export type TimelineEvent = {
  id: string;
  when: string;        // "1985年春" | "第2章時点で10年前" 等
  event: string;
  involvedCharacters: string[]; // character id[]
  location?: string;
};

export type StoryLocation = {
  id: string;
  name: string;
  description?: string;
};

export type Foreshadow = {
  id: string;
  content: string;
  seededAt?: string;         // "chapterId::sectionId" or free text
  plannedResolution?: string;
  resolvedAt?: string;
  status: "seeded" | "resolved" | "unresolved";
};

/**
 * 人物相関図の 1 本の関係。
 * - mutual=true  : 対等な関係 (親友・夫婦・同僚)。矢印なしの 1 本線
 * - mutual=false : 向きのある関係 (片想い・憧れ・憎悪)。from→to の矢印。
 *                  逆向きの感情が異なる場合は別エントリとして両方向を登録する
 * - source       : "ai" は AI 抽出分 (更新時に置き換え対象)、"manual" は手動登録 (保持される)
 */
export type CharacterRelationship = {
  id: string;
  fromId: string;
  toId: string;
  label: string;      // 相関図に載せる短いラベル (親子 / 幼馴染 / 商売敵)
  mutual: boolean;
  notes?: string;
  source: "ai" | "manual";
};

export type StoryBible = {
  worldRules: WorldRule[];
  timelineEvents: TimelineEvent[];
  locations: StoryLocation[];
  foreshadowingItems: Foreshadow[];
  continuityFacts: string[];    // "主人公は左利き" 等の細部
  unresolvedQuestions: string[]; // 読者に残っている疑問
  relationships: CharacterRelationship[]; // 人物相関図
};
