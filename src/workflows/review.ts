import { getWorkflowMetadata } from "workflow";
import type { PromptTemplate, SectionDraft, WritingMemory } from "@/lib/types";
import { defaultPrompts } from "@/lib/samples";
import { renderTemplate } from "@/lib/promptVars";
import { safeJsonParse } from "@/lib/json";
import { runAiStep } from "./shared";

export type ReviewWorkflowInput = {
  draft: SectionDraft;
  writingMemory: WritingMemory;
  promptTemplate?: PromptTemplate;
};

export type ReviewWorkflowResult = {
  editorNotes: string[];
  followUpQuestions: string[];
  factCheckPoints: string[];
  revisionSuggestions: string[];
  parseFailed?: boolean;
  meta: { model: string; provider: string; attempts: number; runId: string };
};

export async function reviewWorkflow(input: ReviewWorkflowInput): Promise<ReviewWorkflowResult> {
  "use workflow";
  const runId = getWorkflowMetadata().workflowRunId;
  return await reviewStep(input, runId);
}

async function reviewStep(
  input: ReviewWorkflowInput,
  runId: string,
): Promise<ReviewWorkflowResult> {
  "use step";

  const tpl = input.promptTemplate || defaultPrompts.find((d) => d.id === "prompt-review")!;
  const userPrompt = renderTemplate(tpl.userPromptTemplate, {
    body: input.draft.body,
    writingMemory: JSON.stringify(input.writingMemory ?? {}, null, 2),
  });
  const formatNote = `\n\n出力は次のJSON形式（余計な文字は禁止）：\n${tpl.outputFormat}`;

  const result = await runAiStep(
    {
      messages: [
        { role: "system", content: tpl.systemPrompt },
        { role: "user", content: userPrompt + formatNote },
      ],
      maxTokens: 4096,
      maxAttempts: 2,
    },
    (raw) => {
      const parsed = safeJsonParse<any>(raw);
      if (!parsed) return null;
      return {
        editorNotes: strArr(parsed.editorNotes),
        followUpQuestions: strArr(parsed.followUpQuestions),
        factCheckPoints: strArr(parsed.factCheckPoints),
        revisionSuggestions: strArr(parsed.revisionSuggestions),
      };
    },
  );

  if (!result.parsed) {
    return {
      editorNotes: [],
      followUpQuestions: [],
      factCheckPoints: [],
      revisionSuggestions: [`AI出力をJSONとして解釈できませんでした (${result.attempts}回試行)。`],
      parseFailed: true,
      meta: { model: result.model, provider: result.provider, attempts: result.attempts, runId },
    };
  }

  return {
    ...result.parsed,
    meta: { model: result.model, provider: result.provider, attempts: result.attempts, runId },
  };
}

function strArr(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}
