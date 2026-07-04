import { getWorkflowMetadata } from "workflow";
import type { Chapter, OutlineProposal, Section } from "@/lib/types";
import { defaultPrompts } from "@/lib/samples";
import { renderTemplate } from "@/lib/promptVars";
import { safeJsonParse } from "@/lib/json";
import { makeId } from "@/lib/ids";
import { runAiStep } from "./shared";

export type RefineOutlineInput = {
  outline: OutlineProposal;
  instruction: string;
  scope: "whole" | "chapter" | "section";
  chapterId?: string;
  sectionId?: string;
  genreLabel: string;
  unit: string; // 「章」「幕」「見出しブロック」等
};

export type RefineOutlineResult =
  | { ok: true; outline: OutlineProposal; meta: { runId: string } }
  | { ok: false; error: string; meta: { runId: string } };

export async function refineOutlineWorkflow(
  input: RefineOutlineInput,
): Promise<RefineOutlineResult> {
  "use workflow";
  const runId = getWorkflowMetadata().workflowRunId;
  if (input.scope === "section") {
    return await refineSectionStep(input, runId);
  }
  if (input.scope === "chapter") {
    return await refineChapterStep(input, runId);
  }
  return await refineWholeStep(input, runId);
}

async function refineSectionStep(
  input: RefineOutlineInput,
  runId: string,
): Promise<RefineOutlineResult> {
  "use step";
  const chapter = input.outline.chapters.find((c) => c.id === input.chapterId);
  const target = chapter?.sections.find((s) => s.id === input.sectionId);
  if (!chapter || !target) {
    return { ok: false, error: "対象の小見出しが見つかりません。", meta: { runId } };
  }
  const tpl = defaultPrompts.find((d) => d.id === "prompt-refine-section")!;
  const userPrompt = renderTemplate(tpl.userPromptTemplate, {
    genreLabel: input.genreLabel,
    chapterTitle: chapter.title,
    chapterSummary: chapter.summary ?? "",
    section: JSON.stringify(
      { id: target.id, title: target.title, summary: target.summary ?? "" },
      null,
      2,
    ),
    instruction: input.instruction,
  });
  const formatNote = `\n\n出力は次のJSON形式（余計な文字は禁止）：\n${tpl.outputFormat}`;

  const result = await runAiStep(
    {
      messages: [
        { role: "system", content: tpl.systemPrompt },
        { role: "user", content: userPrompt + formatNote },
      ],
      maxTokens: 1200,
      maxAttempts: 2,
    },
    (raw) => {
      const parsed = safeJsonParse<any>(raw);
      if (!parsed) return null;
      const sec = parsed.section ?? parsed;
      const title = typeof sec?.title === "string" ? sec.title : "";
      if (!title) return null;
      return { title, summary: typeof sec?.summary === "string" ? sec.summary : target.summary };
    },
  );

  if (!result.parsed) {
    return { ok: false, error: "小見出しの修正に失敗しました。", meta: { runId } };
  }
  const nextChapters = input.outline.chapters.map((c) =>
    c.id !== chapter.id
      ? c
      : {
          ...c,
          sections: c.sections.map((s) =>
            s.id === target.id
              ? { ...s, title: result.parsed!.title, summary: result.parsed!.summary }
              : s,
          ),
        },
  );
  return { ok: true, outline: { ...input.outline, chapters: nextChapters }, meta: { runId } };
}

async function refineWholeStep(
  input: RefineOutlineInput,
  runId: string,
): Promise<RefineOutlineResult> {
  "use step";
  const tpl = defaultPrompts.find((d) => d.id === "prompt-refine-outline")!;
  const systemPrompt = tpl.systemPrompt.replace(/\{\{unit\}\}/g, input.unit);
  const userPrompt = renderTemplate(tpl.userPromptTemplate, {
    genreLabel: input.genreLabel,
    outline: JSON.stringify(input.outline, null, 2),
    instruction: input.instruction,
  });
  const formatNote = `\n\n出力は次のJSON形式（余計な文字は禁止）：\n${tpl.outputFormat}`;

  const result = await runAiStep(
    {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt + formatNote },
      ],
      maxTokens: 8000,
      maxAttempts: 2,
    },
    (raw) => {
      const parsed = safeJsonParse<any>(raw);
      if (!parsed) return null;
      const ai = parsed.outline ?? parsed;
      const chapters = normalizeChapters(ai?.chapters, input.outline.chapters);
      if (chapters.length === 0) return null;
      return { ...input.outline, chapters };
    },
  );

  if (!result.parsed) {
    return { ok: false, error: "構成の改善に失敗しました。", meta: { runId } };
  }
  return { ok: true, outline: result.parsed, meta: { runId } };
}

async function refineChapterStep(
  input: RefineOutlineInput,
  runId: string,
): Promise<RefineOutlineResult> {
  "use step";
  const target = input.outline.chapters.find((c) => c.id === input.chapterId);
  if (!target) {
    return { ok: false, error: "対象の章が見つかりません。", meta: { runId } };
  }
  const tpl = defaultPrompts.find((d) => d.id === "prompt-refine-chapter")!;
  const overview = input.outline.chapters
    .map((c) => `第${c.chapterNumber}: ${c.title}`)
    .join("\n");
  const userPrompt = renderTemplate(tpl.userPromptTemplate, {
    genreLabel: input.genreLabel,
    outlineOverview: overview,
    chapter: JSON.stringify(
      { id: target.id, chapterNumber: target.chapterNumber, title: target.title, summary: target.summary },
      null,
      2,
    ),
    instruction: input.instruction,
  });
  const formatNote = `\n\n出力は次のJSON形式（余計な文字は禁止）：\n${tpl.outputFormat}`;

  const result = await runAiStep(
    {
      messages: [
        { role: "system", content: tpl.systemPrompt },
        { role: "user", content: userPrompt + formatNote },
      ],
      maxTokens: 1500,
      maxAttempts: 2,
    },
    (raw) => {
      const parsed = safeJsonParse<any>(raw);
      if (!parsed) return null;
      const ch = parsed.chapter ?? parsed;
      const title = typeof ch?.title === "string" ? ch.title : "";
      if (!title) return null;
      return {
        title,
        summary: typeof ch?.summary === "string" ? ch.summary : target.summary,
      };
    },
  );

  if (!result.parsed) {
    return { ok: false, error: "章の修正に失敗しました。", meta: { runId } };
  }
  const nextChapters = input.outline.chapters.map((c) =>
    c.id === target.id ? { ...c, title: result.parsed!.title, summary: result.parsed!.summary } : c,
  );
  return { ok: true, outline: { ...input.outline, chapters: nextChapters }, meta: { runId } };
}

/** AI が返した chapters を正規化。既存の id・sections をできる限り保持し、番号は振り直す */
function normalizeChapters(raw: unknown, prev: Chapter[]): Chapter[] {
  if (!Array.isArray(raw)) return [];
  const prevById = new Map(prev.map((c) => [c.id, c]));
  return raw
    .map((c: any, i: number): Chapter | null => {
      const title = typeof c?.title === "string" ? c.title : "";
      if (!title) return null;
      const id = typeof c?.id === "string" && c.id ? c.id : `chapter-${i + 1}-${makeId("c")}`;
      const existing = prevById.get(id);
      const sections: Section[] = Array.isArray(c?.sections)
        ? c.sections
            .map((s: any, j: number): Section | null => {
              const st = typeof s?.title === "string" ? s.title : "";
              if (!st) return null;
              return {
                id: typeof s?.id === "string" && s.id ? s.id : `section-${j + 1}-${makeId("s")}`,
                title: st,
                summary: typeof s?.summary === "string" ? s.summary : undefined,
              };
            })
            .filter((x: Section | null): x is Section => !!x)
        : existing?.sections ?? [];
      return {
        id,
        chapterNumber: i + 1,
        title,
        summary: typeof c?.summary === "string" ? c.summary : existing?.summary ?? "",
        sections,
      };
    })
    .filter((x): x is Chapter => !!x);
}
