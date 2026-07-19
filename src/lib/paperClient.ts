"use client";

import { postJson } from "./apiClient";
import { paperTypeLabel } from "./genreConfig";
import type { Project } from "./types";

/** 論文仕様をテキスト化（要旨・予稿プロンプトへ渡す） */
export function buildPaperMetaText(project: Project): string {
  const m = project.paperMeta;
  return [
    `タイトル: ${project.name}`,
    `論文種別: ${paperTypeLabel(m?.paperType)}`,
    `分野: ${m?.field || "（未設定）"}`,
    `リサーチクエスチョン: ${m?.researchQuestion || "（未設定）"}`,
    `貢献・新規性: ${m?.contributions || "（未設定）"}`,
    `想定投稿先・読者: ${m?.venue || "（未設定）"}`,
    m?.keywords ? `キーワード: ${m.keywords}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * 本文の要点（各節のタイトル＋抜粋）をコンパクトに組み立てる。
 * フル本文を送るとペイロードが肥大するため、章構成順に抜粋だけを送る。
 */
export function buildPaperSummary(project: Project, perSectionChars = 500): string {
  const parts: string[] = [];
  for (const c of project.selectedOutline?.chapters ?? []) {
    parts.push(`\n■ ${c.title}`);
    for (const s of c.sections ?? []) {
      const draft = project.generatedSections.find(
        (d) => d.chapterId === c.id && d.sectionId === s.id,
      );
      if (draft?.body?.trim()) {
        parts.push(`【${s.title}】\n${draft.body.slice(0, perSectionChars)}`);
      }
    }
  }
  return parts.join("\n");
}

export async function generateAbstract(
  project: Project,
): Promise<{ abstract: string; keywords: string }> {
  const r = await postJson<{ abstract?: string; keywords?: string }>("/api/generate-abstract", {
    paperMeta: buildPaperMetaText(project),
    summary: buildPaperSummary(project, 500),
  });
  if (!r.ok) throw new Error(r.error ?? "要旨の生成に失敗しました。");
  return { abstract: r.data?.abstract ?? "", keywords: r.data?.keywords ?? "" };
}

export async function generatePreprint(project: Project): Promise<string> {
  const r = await postJson<{ preprint?: string }>("/api/generate-preprint", {
    paperMeta: buildPaperMetaText(project),
    summary: buildPaperSummary(project, 700),
  });
  if (!r.ok) throw new Error(r.error ?? "予稿の生成に失敗しました。");
  return r.data?.preprint ?? "";
}
