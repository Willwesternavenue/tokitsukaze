"use client";

/**
 * 翻訳書モードのクライアント側共通ヘルパ。
 * /writer（単発・一括翻訳）と /terms（対訳表の波及再翻訳）の両方から使う。
 */

import { pollRun, postJson } from "./apiClient";
import {
  effectiveTermPairs,
  getSelectedReferenceWorks,
  loadProject,
  loadPrompts,
  saveSectionAgentReports,
  upsertDraft,
  withStyleRules,
} from "./storage";
import { getGenreConfig } from "./genreConfig";
import type { DraftWorkflowResult } from "@/workflows/draft";
import type { Chapter, Project, Section } from "./types";

/**
 * API に渡す project を軽量化する（翻訳書モードのみ）。
 * 原文（sourceText）は現在のセクション以外では不要で、書籍全体だと数百KB〜MBになり
 * Vercel の body 制限・プロンプト肥大の原因になるため落とす。bodyHistory も同様。
 */
export function slimProjectForDraft(project: Project, keepSectionId: string): Project {
  if (project.genre !== "translation") return project;
  return {
    ...project,
    // 参照グローバル対訳表＋プロジェクト固有をマージした実効対訳表を送る
    // （サーバ側の翻訳者・用語統一チェックはそのまま project.termPairs を読む）
    termPairs: effectiveTermPairs(project),
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
 * 本文生成を開始し runId を返す（サーバ側でバックグラウンド実行）。
 * runId を保存しておけば、タブ切替・移動・リロードから復帰して結果を回収できる。
 */
export async function startSectionDraft(
  baseProject: Project,
  chapter: Chapter,
  section: Section,
): Promise<string> {
  const prompts = loadPrompts();
  const base = prompts.find(
    (p) => p.id === getGenreConfig(baseProject.genre).pipelinePrompts.draft,
  );
  const promptTemplate = base ? withStyleRules(base) : undefined;
  const r = await postJson<{ runId?: string }>("/api/generate-draft", {
    project: slimProjectForDraft(baseProject, section.id),
    chapter,
    section,
    promptTemplate,
    referenceWorks: getSelectedReferenceWorks(baseProject),
  });
  if (!r.ok) throw new Error(r.error ?? "生成の開始に失敗しました。");
  const runId = r.data?.runId;
  if (!runId) throw new Error("生成を開始できませんでした。");
  return runId;
}

/**
 * 開始済み run（runId）を完了までポーリングし、結果を localStorage に保存して
 * 最新の Project を返す。復帰（resume）でもそのまま使える。
 * 翻訳書モードでは既存訳文を bodyHistory に退避する。
 */
export async function finishSectionDraft(runId: string): Promise<Project> {
  const poll = await pollRun<DraftWorkflowResult>(runId);
  if (!poll.ok) throw new Error(poll.error);
  const draft = poll.result?.draft;
  if (!draft) throw new Error("AIから本文が返りませんでした。");

  // 適用先は「現在の」プロジェクト（復帰時も含めて最新を読む）
  const current = loadProject();
  if (current.genre === "translation") {
    const old = current.generatedSections.find(
      (d) => d.chapterId === draft.chapterId && d.sectionId === draft.sectionId,
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
  return saveSectionAgentReports(key, poll.result.agentReports ?? []);
}

/**
 * 1セクションの本文を生成して保存し、最新の Project を返す（開始→完了の一括版）。
 * 一括翻訳・波及再生成などのループから使う。
 */
export async function generateSectionDraft(
  baseProject: Project,
  chapter: Chapter,
  section: Section,
): Promise<Project> {
  const runId = await startSectionDraft(baseProject, chapter, section);
  return finishSectionDraft(runId);
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
