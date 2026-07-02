export type Section = {
  id: string;
  title: string;
  summary?: string;
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
  genre: "biography" | "novel";
  characters: NovelCharacter[];
  storyBible: StoryBible;
  // ===== Nav 再構成: AIスタッフのトグルと診断結果の永続化 =====
  /** 自動レビュアーの有効/無効。未設定キーは有効扱い */
  agentToggles?: Partial<Record<AgentKey, boolean>>;
  /** "chapterId::sectionId" → 直近の診断結果。/review 画面の集約元 */
  sectionAgentReports?: Record<string, AgentReportSummary[]>;
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
  | "tension-checker";

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

export type Genre = "biography" | "novel";

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
