import { and, eq } from "drizzle-orm";
import { getDb, isDbConfigured } from "./client";
import { agentReports, projects, sections } from "./schema";
import type { SectionDraft, Project as ProjectShape } from "@/lib/types";
import { makeId } from "@/lib/ids";

/**
 * DB 未設定なら全て no-op で成功扱い。既存 localStorage フローを壊さない。
 */

export async function saveProjectSnapshot(project: ProjectShape): Promise<void> {
  if (!isDbConfigured()) return;
  const db = getDb();
  if (!db) return;
  try {
    const now = new Date();
    await db
      .insert(projects)
      .values({
        id: project.id,
        name: project.name,
        genre: (project as any).genre ?? "biography",
        data: project as any,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: projects.id,
        set: {
          name: project.name,
          genre: (project as any).genre ?? "biography",
          data: project as any,
          updatedAt: now,
        },
      });
  } catch (e) {
    console.warn("[db] saveProjectSnapshot failed (ignored)", e);
  }
}

export async function saveSectionDraft(
  projectId: string,
  draft: SectionDraft,
  meta: { runId?: string | null; model?: string | null; promptVersion?: string | null } = {},
): Promise<void> {
  if (!isDbConfigured()) return;
  const db = getDb();
  if (!db) return;
  try {
    const now = new Date();
    await db
      .insert(sections)
      .values({
        id: draft.id,
        projectId,
        chapterId: draft.chapterId,
        sectionId: draft.sectionId,
        chapterTitle: draft.chapterTitle,
        sectionTitle: draft.sectionTitle,
        body: draft.body,
        editorNotes: draft.editorNotes,
        followUpQuestions: draft.followUpQuestions,
        factCheckPoints: draft.factCheckPoints,
        continuityNotes: draft.continuityNotes,
        runId: meta.runId ?? null,
        model: meta.model ?? null,
        promptVersion: meta.promptVersion ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: sections.id,
        set: {
          body: draft.body,
          editorNotes: draft.editorNotes,
          followUpQuestions: draft.followUpQuestions,
          factCheckPoints: draft.factCheckPoints,
          continuityNotes: draft.continuityNotes,
          runId: meta.runId ?? null,
          model: meta.model ?? null,
          promptVersion: meta.promptVersion ?? null,
          updatedAt: now,
        },
      });
  } catch (e) {
    console.warn("[db] saveSectionDraft failed (ignored)", e);
  }
}

export async function saveAgentReport(input: {
  projectId: string;
  agent: string;
  targetType: "section" | "chapter" | "book";
  targetId: string;
  severity?: "info" | "warning" | "error";
  findings: { severity: "info" | "warning" | "error"; message: string; loc?: string }[];
  runId?: string | null;
  model?: string | null;
  promptVersion?: string | null;
}): Promise<void> {
  if (!isDbConfigured()) return;
  const db = getDb();
  if (!db) return;
  try {
    await db.insert(agentReports).values({
      id: makeId("report"),
      projectId: input.projectId,
      agent: input.agent,
      targetType: input.targetType,
      targetId: input.targetId,
      severity: input.severity ?? null,
      findings: input.findings,
      runId: input.runId ?? null,
      model: input.model ?? null,
      promptVersion: input.promptVersion ?? null,
      createdAt: new Date(),
    });
  } catch (e) {
    console.warn("[db] saveAgentReport failed (ignored)", e);
  }
}
