import { getWorkflowMetadata } from "workflow";
import type { Chapter, Project, PromptTemplate, Section, SectionDraft } from "@/lib/types";
import { defaultPrompts } from "@/lib/samples";
import { renderTemplate } from "@/lib/promptVars";
import { safeJsonParse } from "@/lib/json";
import { makeId } from "@/lib/ids";
import { runAiStep } from "./shared";
import { saveSectionDraft } from "@/db/queries";

export type DraftWorkflowInput = {
  project: Project;
  chapter: Chapter;
  section: Section;
  promptTemplate?: PromptTemplate;
};

export type DraftWorkflowResult = {
  ok: boolean;
  draft: SectionDraft;
  parseFailed?: boolean;
  meta: { model: string; provider: string; attempts: number; runId: string };
};

export async function draftWorkflow(input: DraftWorkflowInput): Promise<DraftWorkflowResult> {
  "use workflow";
  const runId = getWorkflowMetadata().workflowRunId;
  const result = await draftStep(input, runId);
  // 生成成功時のみ DB に永続化 (DB 未設定なら no-op)
  await persistDraftStep(input.project.id, result.draft, {
    runId: result.meta.runId,
    model: result.meta.model,
  });
  return result;
}

async function draftStep(
  input: DraftWorkflowInput,
  runId: string,
): Promise<DraftWorkflowResult> {
  "use step";

  const { project, chapter, section } = input;
  const tpl = input.promptTemplate || defaultPrompts.find((d) => d.id === "prompt-draft")!;

  const previous = project.generatedSections
    .map((d) => `■ ${d.chapterTitle} / ${d.sectionTitle}\n${d.body.slice(0, 240)}`)
    .join("\n\n");

  const userPrompt = renderTemplate(tpl.userPromptTemplate, {
    projectName: project.name,
    intervieweeName: project.intervieweeName,
    theme: project.theme,
    targetReader: project.targetReader,
    desiredTone: project.desiredTone,
    interviewNotes: project.interviewNotes,
    writingMemory: JSON.stringify(project.writingMemory ?? {}, null, 2),
    outlineSummary: project.selectedOutline
      ? `${project.selectedOutline.title}：${project.selectedOutline.concept}`
      : "",
    previousChapterSummaries: previous || "（まだ生成済みの章なし）",
    chapterTitle: chapter.title,
    chapterNumber: String(chapter.chapterNumber),
    chapterSummary: chapter.summary ?? "",
    sectionTitle: section.title,
    sectionSummary: section.summary ?? "",
  });
  const formatNote = `\n\n出力は次のJSON形式（余計な文字は禁止）：\n${tpl.outputFormat}`;

  const result = await runAiStep(
    {
      messages: [
        { role: "system", content: tpl.systemPrompt },
        { role: "user", content: userPrompt + formatNote },
      ],
      maxTokens: 6000,
      maxAttempts: 2,
    },
    (raw) => {
      const parsed = safeJsonParse<{ draft?: any } | any>(raw);
      if (!parsed) return null;
      const draftRaw = (parsed as any).draft ?? parsed;
      if (typeof draftRaw?.body !== "string" || !draftRaw.body.trim()) return null;
      const draft: SectionDraft = {
        id: typeof draftRaw?.id === "string" && draftRaw.id ? draftRaw.id : makeId("draft"),
        chapterId: chapter.id,
        sectionId: section.id,
        chapterTitle: chapter.title,
        sectionTitle: section.title,
        body: draftRaw.body,
        editorNotes: strArr(draftRaw?.editorNotes),
        followUpQuestions: strArr(draftRaw?.followUpQuestions),
        factCheckPoints: strArr(draftRaw?.factCheckPoints),
        continuityNotes: strArr(draftRaw?.continuityNotes),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      return draft;
    },
  );

  if (!result.parsed) {
    const fallback: SectionDraft = {
      id: makeId("draft"),
      chapterId: chapter.id,
      sectionId: section.id,
      chapterTitle: chapter.title,
      sectionTitle: section.title,
      body: typeof result.raw === "string" ? result.raw.slice(0, 2000) : "",
      editorNotes: [
        `AI出力をJSONとして解釈できなかったため、テキストをそのまま表示しています (${result.attempts}回試行)。`,
      ],
      followUpQuestions: [],
      factCheckPoints: [],
      continuityNotes: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    return {
      ok: false,
      parseFailed: true,
      draft: fallback,
      meta: { model: result.model, provider: result.provider, attempts: result.attempts, runId },
    };
  }
  return {
    ok: true,
    draft: result.parsed,
    meta: { model: result.model, provider: result.provider, attempts: result.attempts, runId },
  };
}

async function persistDraftStep(
  projectId: string,
  draft: SectionDraft,
  meta: { runId: string; model: string },
): Promise<void> {
  "use step";
  await saveSectionDraft(projectId, draft, {
    runId: meta.runId,
    model: meta.model,
    promptVersion: null,
  });
}

function strArr(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}
