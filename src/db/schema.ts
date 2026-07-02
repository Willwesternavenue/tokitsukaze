import { pgTable, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";

/**
 * P1 スキーマ:
 * - projects: プロジェクト本体 (Project 型を jsonb で持つ。移行を軽くする)
 * - sections: 生成された本文 draft (workflow runId とセットで保存)
 * - agent_reports: マルチエージェント化の findings 保存先 (P1 では空、テーブルだけ)
 * - prompt_templates: 将来 DB 化するプロンプトテンプレート (P1 では空、テーブルだけ)
 *
 * localStorage を破棄しないため、DB は「あれば使う」姿勢。
 * P1 では draft 生成時のみ DB に upsert し、clientの読み書きは localStorage のまま。
 */

export const projects = pgTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  // 将来: novel | screenplay | business | biography
  genre: text("genre").notNull().default("biography"),
  data: jsonb("data").notNull(), // Full Project 型を保存 (interviewNotes, outlineProposals, writingMemory 等)
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const sections = pgTable(
  "sections",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    chapterId: text("chapter_id").notNull(),
    sectionId: text("section_id").notNull(),
    chapterTitle: text("chapter_title").notNull(),
    sectionTitle: text("section_title").notNull(),
    body: text("body").notNull(),
    editorNotes: jsonb("editor_notes").$type<string[]>().notNull().default([]),
    followUpQuestions: jsonb("follow_up_questions").$type<string[]>().notNull().default([]),
    factCheckPoints: jsonb("fact_check_points").$type<string[]>().notNull().default([]),
    continuityNotes: jsonb("continuity_notes").$type<string[]>().notNull().default([]),
    // Workflow の run 追跡: P2 以降で run detail に遷移するリンクに使う
    runId: text("run_id"),
    model: text("model"),
    promptVersion: text("prompt_version"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    projectChapterIdx: index("sections_project_chapter_idx").on(t.projectId, t.chapterId),
    sectionKeyIdx: index("sections_key_idx").on(t.projectId, t.chapterId, t.sectionId),
  }),
);

// P1 では空。P2 以降 Proofreader / Consistency / Reader Experience 等の findings を溜める
export const agentReports = pgTable(
  "agent_reports",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    agent: text("agent").notNull(), // "proofreader" | "reader-experience" | "consistency" | ...
    targetType: text("target_type").notNull(), // "section" | "chapter" | "book"
    targetId: text("target_id").notNull(),
    severity: text("severity"), // "info" | "warning" | "error"
    findings: jsonb("findings").$type<Finding[]>().notNull().default([]),
    runId: text("run_id"),
    model: text("model"),
    promptVersion: text("prompt_version"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    projectAgentIdx: index("agent_reports_project_agent_idx").on(t.projectId, t.agent),
    targetIdx: index("agent_reports_target_idx").on(t.targetType, t.targetId),
  }),
);

// P1 では空。P2 以降でプロンプトを DB 側で version 管理する
export const promptTemplates = pgTable(
  "prompt_templates",
  {
    id: text("id").primaryKey(),
    agent: text("agent").notNull(),
    genre: text("genre").notNull().default("common"), // common | novel | biography | screenplay | business
    version: text("version").notNull().default("v1"),
    name: text("name").notNull(),
    description: text("description"),
    systemPrompt: text("system_prompt").notNull(),
    userPromptTemplate: text("user_prompt_template").notNull(),
    outputFormat: text("output_format"),
    evalNotes: text("eval_notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    agentGenreVersionIdx: index("prompts_agent_genre_version_idx").on(t.agent, t.genre, t.version),
  }),
);

export type Finding = {
  severity: "info" | "warning" | "error";
  message: string;
  loc?: string;
};

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type Section = typeof sections.$inferSelect;
export type NewSection = typeof sections.$inferInsert;
export type AgentReport = typeof agentReports.$inferSelect;
export type NewAgentReport = typeof agentReports.$inferInsert;
