import { getWorkflowMetadata } from "workflow";
import type {
  AgentReportSummary,
  Chapter,
  Project,
  PromptTemplate,
  Section,
  SectionDraft,
} from "@/lib/types";
import { defaultPrompts } from "@/lib/samples";
import { renderTemplate } from "@/lib/promptVars";
import { safeJsonParse } from "@/lib/json";
import { makeId } from "@/lib/ids";
import { runAiStep } from "./shared";
import { saveAgentReport, saveProjectSnapshot, saveSectionDraft } from "@/db/queries";
import {
  consistencyLiteStep,
  proofreaderStep,
  readerExperienceStep,
  styleGuardianStep,
} from "./agents/reviewers";

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
  agentReports: AgentReportSummary[];
  meta: { model: string; provider: string; attempts: number; runId: string };
};

export async function draftWorkflow(input: DraftWorkflowInput): Promise<DraftWorkflowResult> {
  "use workflow";
  const runId = getWorkflowMetadata().workflowRunId;

  // 1. 本文生成 (既存)
  const result = await draftStep(input, runId);

  // 2. 本文が成功した時だけ 4 エージェントを並列実行
  //    (失敗時のフォールバック本文にレビューをかけても意味がないので skip)
  let agentReports: AgentReportSummary[] = [];
  if (result.ok) {
    const ctx = {
      draft: result.draft,
      project: input.project,
      chapter: input.chapter,
      section: input.section,
    };
    // 各 step は個別 "use step"、並列実行。
    // reviewer 内部で失敗を吸収するので Promise.all が reject しない設計にしてある。
    agentReports = await Promise.all([
      proofreaderStep(ctx, runId),
      styleGuardianStep(ctx, runId),
      consistencyLiteStep(ctx, runId),
      readerExperienceStep(ctx, runId),
    ]);
  }

  // 3. 全部まとめて永続化 (DB 未設定なら no-op)
  await persistAllStep(input.project, result.draft, agentReports, {
    runId: result.meta.runId,
    model: result.meta.model,
  });

  return { ...result, agentReports };
}

async function draftStep(
  input: DraftWorkflowInput,
  runId: string,
): Promise<Omit<DraftWorkflowResult, "agentReports">> {
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

async function persistAllStep(
  project: Project,
  draft: SectionDraft,
  reports: AgentReportSummary[],
  meta: { runId: string; model: string },
): Promise<void> {
  "use step";
  // 1. project を先に upsert (FK 制約を満たすため)
  await saveProjectSnapshot(project);
  // 2. section を保存
  await saveSectionDraft(project.id, draft, {
    runId: meta.runId,
    model: meta.model,
    promptVersion: null,
  });
  // 3. 4 エージェントの findings を agent_reports に保存
  for (const r of reports) {
    if (r.findings.length === 0 && !r.meta.parseFailed) continue; // 指摘なしの成功はログのみで済ませる
    await saveAgentReport({
      projectId: project.id,
      agent: r.agent,
      targetType: "section",
      targetId: draft.id,
      severity: aggregateSeverity(r.findings),
      findings: r.findings,
      runId: r.meta.runId,
      model: r.meta.model,
      promptVersion: null,
    });
  }
}

function aggregateSeverity(
  findings: AgentReportSummary["findings"],
): "info" | "warning" | "error" | undefined {
  if (findings.some((f) => f.severity === "error")) return "error";
  if (findings.some((f) => f.severity === "warning")) return "warning";
  if (findings.some((f) => f.severity === "info")) return "info";
  return undefined;
}

function strArr(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}
