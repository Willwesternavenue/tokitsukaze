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
};

export type ReviewResult = {
  editorNotes: string[];
  followUpQuestions: string[];
  factCheckPoints: string[];
  revisionSuggestions: string[];
};
