import { getWorkflowMetadata } from "workflow";
import type { Project } from "@/lib/types";
import { defaultPrompts } from "@/lib/samples";
import { planningModel } from "@/lib/ai";
import { getGenreConfig } from "@/lib/genreConfig";
import { renderTemplate } from "@/lib/promptVars";
import { safeJsonParse } from "@/lib/json";
import { runAiStep } from "./shared";

export type InterviewQuestionsInput = {
  project: Project;
};

export type InterviewQuestionsResult =
  | { ok: true; questions: string[]; meta: { runId: string } }
  | { ok: false; error: string; meta: { runId: string } };

/**
 * 章立て生成の前に、著者へ確認する質問（3〜10問）を作る。
 */
export async function interviewQuestionsWorkflow(
  input: InterviewQuestionsInput,
): Promise<InterviewQuestionsResult> {
  "use workflow";
  const runId = getWorkflowMetadata().workflowRunId;
  return await questionsStep(input, runId);
}

async function questionsStep(
  input: InterviewQuestionsInput,
  runId: string,
): Promise<InterviewQuestionsResult> {
  "use step";
  const p = input.project;
  const tpl = defaultPrompts.find((d) => d.id === "prompt-interview-questions")!;
  const userPrompt = renderTemplate(tpl.userPromptTemplate, {
    genreLabel: getGenreConfig(p.genre).label,
    intervieweeName: p.intervieweeName ?? "",
    theme: p.theme ?? "",
    targetReader: p.targetReader ?? "",
    desiredTone: p.desiredTone ?? "",
    charCount: String((p.interviewNotes ?? "").length),
    interviewNotes: (p.interviewNotes ?? "").slice(0, 16000),
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
      model: planningModel(),
      timeoutMs: 60000,
    },
    (raw) => {
      const parsed = safeJsonParse<{ questions?: unknown }>(raw);
      if (!parsed) return null;
      const arr = Array.isArray((parsed as any).questions) ? (parsed as any).questions : [];
      const questions = arr
        .filter((q: unknown): q is string => typeof q === "string" && q.trim().length > 0)
        .map((q: string) => q.trim())
        .slice(0, 10);
      if (questions.length === 0) return null;
      return { questions };
    },
  );

  if (!result.parsed) {
    return { ok: false, error: "質問の生成に失敗しました。", meta: { runId } };
  }
  return { ok: true, questions: result.parsed.questions, meta: { runId } };
}
