import { getWorkflowMetadata } from "workflow";
import type { Chapter, OutlineProposal, Section, WritingMemory } from "@/lib/types";
import { defaultPrompts } from "@/lib/samples";
import { renderTemplate } from "@/lib/promptVars";
import { safeJsonParse } from "@/lib/json";
import { makeId } from "@/lib/ids";
import { runAiStep } from "./shared";

export type SectionsWorkflowInput = {
  selectedOutline: OutlineProposal;
  interviewNotes: string;
  writingMemory: WritingMemory;
};

export type SectionsWorkflowResult = {
  ok: true;
  outline: OutlineProposal;
  meta: { model: string; provider: string; attempts: number; runId: string };
} | {
  ok: false;
  outline: OutlineProposal; // フォールバック（元の構成案）
  parseFailed: true;
  raw?: string;
  meta: { model: string; provider: string; attempts: number; runId: string };
};

export async function sectionsWorkflow(input: SectionsWorkflowInput): Promise<SectionsWorkflowResult> {
  "use workflow";
  const runId = getWorkflowMetadata().workflowRunId;
  return await sectionsStep(input, runId);
}

async function sectionsStep(
  input: SectionsWorkflowInput,
  runId: string,
): Promise<SectionsWorkflowResult> {
  "use step";

  const tpl = defaultPrompts.find((d) => d.id === "prompt-sections")!;
  const systemPrompt = tpl.systemPrompt;
  const userPrompt = renderTemplate(tpl.userPromptTemplate, {
    interviewNotes: input.interviewNotes ?? "",
    selectedOutline: JSON.stringify(input.selectedOutline, null, 2),
    writingMemory: JSON.stringify(input.writingMemory ?? {}, null, 2),
  });
  const formatNote = `\n\n出力は次のJSON形式（余計な文字は禁止）：\n${tpl.outputFormat}`;

  const result = await runAiStep(
    {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt + formatNote },
      ],
      maxTokens: 12000,
      maxAttempts: 2,
    },
    (raw) => {
      const parsed = safeJsonParse<{ outline?: any }>(raw);
      if (!parsed) return null;
      const aiOutline = (parsed as any)?.outline ?? parsed;
      const merged = mergeOutline(input.selectedOutline, aiOutline);
      const totalSections = merged.chapters.reduce((sum, c) => sum + (c.sections?.length ?? 0), 0);
      return totalSections > 0 ? merged : null;
    },
  );

  if (!result.parsed) {
    return {
      ok: false,
      outline: input.selectedOutline,
      parseFailed: true,
      raw: result.raw,
      meta: { model: result.model, provider: result.provider, attempts: result.attempts, runId },
    };
  }
  return {
    ok: true,
    outline: result.parsed,
    meta: { model: result.model, provider: result.provider, attempts: result.attempts, runId },
  };
}

// ==== normalize helpers (現行 API route から移植・そのまま) ====

function asSectionList(raw: unknown): Section[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((s: any, i: number): Section | null => {
      if (s && typeof s === "object") {
        const title =
          typeof s.title === "string" ? s.title : typeof s.name === "string" ? s.name : "";
        if (!title) return null;
        return {
          id: typeof s.id === "string" && s.id ? s.id : `section-${i + 1}-${makeId("s")}`,
          title,
          summary:
            typeof s.summary === "string"
              ? s.summary
              : typeof s.description === "string"
                ? s.description
                : undefined,
        };
      }
      if (typeof s === "string" && s.trim()) {
        return { id: `section-${i + 1}-${makeId("s")}`, title: s.trim() };
      }
      return null;
    })
    .filter((x): x is Section => !!x);
}

function extractAiChapters(aiOutline: any): any[] {
  if (Array.isArray(aiOutline)) return aiOutline;
  if (Array.isArray(aiOutline?.chapters)) return aiOutline.chapters;
  if (Array.isArray(aiOutline?.outline?.chapters)) return aiOutline.outline.chapters;
  return [];
}

function findSectionsByKey(aiOutline: any, chapter: Chapter): unknown {
  if (!aiOutline || typeof aiOutline !== "object") return null;
  const sectionsMap =
    aiOutline.sections && typeof aiOutline.sections === "object" && !Array.isArray(aiOutline.sections)
      ? aiOutline.sections
      : aiOutline;
  if (!sectionsMap || typeof sectionsMap !== "object") return null;
  const keys = [
    chapter.id,
    chapter.title,
    `第${chapter.chapterNumber}章　${chapter.title}`,
    `第${chapter.chapterNumber}章 ${chapter.title}`,
    `chapter-${chapter.chapterNumber}`,
    String(chapter.chapterNumber),
  ];
  for (const k of keys) {
    if (k && (sectionsMap as any)[k] !== undefined) return (sectionsMap as any)[k];
  }
  return null;
}

function mergeOutline(original: OutlineProposal, aiOutline: any): OutlineProposal {
  const aiChapters = extractAiChapters(aiOutline);
  const next: Chapter[] = original.chapters.map((c, i) => {
    const matched =
      aiChapters[i] ||
      aiChapters.find((x: any) => x?.id === c.id) ||
      aiChapters.find(
        (x: any) => typeof x?.title === "string" && x.title.includes(c.title.slice(0, 10)),
      );
    let aiSections = asSectionList(matched?.sections);
    if (aiSections.length === 0) {
      aiSections = asSectionList(findSectionsByKey(aiOutline, c));
    }
    return {
      ...c,
      sections: aiSections.length ? aiSections : c.sections ?? [],
    };
  });
  return { ...original, chapters: next };
}
