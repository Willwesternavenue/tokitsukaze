"use client";

/**
 * 翻訳書モードのクライアント側共通ヘルパ。
 * /writer（単発・一括翻訳）と /terms（対訳表の波及再翻訳）の両方から使う。
 */

import { postJson } from "./apiClient";
import {
  getSelectedReferenceWorks,
  loadPrompts,
  saveSectionAgentReports,
  upsertDraft,
  withStyleRules,
} from "./storage";
import { getGenreConfig } from "./genreConfig";
import type {
  AgentReportSummary,
  Chapter,
  Project,
  Section,
  SectionDraft,
} from "./types";

/**
 * API に渡す project を軽量化する（翻訳書モードのみ）。
 * 原文（sourceText）は現在のセクション以外では不要で、書籍全体だと数百KB〜MBになり
 * Vercel の body 制限・プロンプト肥大の原因になるため落とす。bodyHistory も同様。
 */
export function slimProjectForDraft(project: Project, keepSectionId: string): Project {
  if (project.genre !== "translation") return project;
  return {
    ...project,
    outlineProposals: [],
    selectedOutline: project.selectedOutline
      ? {
          ...project.selectedOutline,
          chapters: project.selectedOutline.chapters.map((c) => ({
            ...c,
            sections: c.sections.map((s) =>
              s.id === keepSectionId ? s : { ...s, sourceText: undefined },
            ),
          })),
        }
      : undefined,
    generatedSections: project.generatedSections.map(({ bodyHistory: _h, ...rest }) => rest),
  };
}

/**
 * 1セクションの本文（翻訳）を生成して localStorage に保存し、最新の Project を返す。
 * - baseProject を context として渡す（バッチ実行では直前の結果を織り込むため毎回最新を渡す）
 * - 翻訳書モードでは既存訳文を bodyHistory に退避してから差し替える
 */
export async function generateSectionDraft(
  baseProject: Project,
  chapter: Chapter,
  section: Section,
): Promise<Project> {
  const prompts = loadPrompts();
  const base = prompts.find(
    (p) => p.id === getGenreConfig(baseProject.genre).pipelinePrompts.draft,
  );
  const promptTemplate = base ? withStyleRules(base) : undefined;
  const r = await postJson<{ draft?: SectionDraft; agentReports?: AgentReportSummary[] }>(
    "/api/generate-draft",
    {
      project: slimProjectForDraft(baseProject, section.id),
      chapter,
      section,
      promptTemplate,
      referenceWorks: getSelectedReferenceWorks(baseProject),
    },
  );
  if (!r.ok) throw new Error(r.error ?? "本文生成に失敗しました。");
  const draft = r.data?.draft;
  if (!draft) throw new Error("AIから本文が返りませんでした。");

  if (baseProject.genre === "translation") {
    const old = baseProject.generatedSections.find(
      (d) => d.chapterId === chapter.id && d.sectionId === section.id,
    );
    if (old?.body) {
      draft.bodyHistory = [
        ...(old.bodyHistory ?? []),
        { savedAt: old.updatedAt, body: old.body, note: "再生成前" },
      ].slice(-10);
    }
  }

  upsertDraft(draft);
  const key = `${draft.chapterId}::${draft.sectionId}`;
  return saveSectionAgentReports(key, r.data?.agentReports ?? []);
}

/** 構成順の (chapter, section) 平坦リスト */
export function flattenOutline(
  project: Project,
): { chapter: Chapter; section: Section }[] {
  const out: { chapter: Chapter; section: Section }[] = [];
  for (const c of project.selectedOutline?.chapters ?? []) {
    for (const s of c.sections ?? []) out.push({ chapter: c, section: s });
  }
  return out;
}

/** 未翻訳（未生成）の (chapter, section) を構成順で返す。chapterId 指定でその章に絞る */
export function listUntranslated(
  project: Project,
  chapterId?: string,
): { chapter: Chapter; section: Section }[] {
  const done = new Set(
    project.generatedSections.filter((d) => d.body?.trim()).map((d) => `${d.chapterId}::${d.sectionId}`),
  );
  return flattenOutline(project).filter(
    ({ chapter, section }) =>
      (!chapterId || chapter.id === chapterId) && !done.has(`${chapter.id}::${section.id}`),
  );
}
