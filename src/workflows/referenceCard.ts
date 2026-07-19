import { getWorkflowMetadata } from "workflow";
import type { Reference, ReferenceCard } from "@/lib/types";
import { defaultPrompts } from "@/lib/samples";
import { renderTemplate } from "@/lib/promptVars";
import { safeJsonParse } from "@/lib/json";
import { makeId } from "@/lib/ids";
import { runAiStep } from "./shared";

/**
 * 論文モード: 文献の本文（PDF等から抽出したテキスト）から文献カルテを作る。
 * 書誌（title/author/year/source）＋ card（目的/手法/結果/貢献/限界/差分）を返す。
 */

export type ReferenceCardWorkflowInput = {
  sourceText: string;
  field?: string;
  researchQuestion?: string;
  sourceFilename?: string;
};

export type ReferenceCardWorkflowResult =
  | {
      ok: true;
      reference: Reference;
      meta: { model: string; provider: string; attempts: number; runId: string };
    }
  | {
      ok: false;
      error: string;
      raw?: string;
      meta: { model: string; provider: string; attempts: number; runId: string };
    };

export async function extractReferenceCardWorkflow(
  input: ReferenceCardWorkflowInput,
): Promise<ReferenceCardWorkflowResult> {
  "use workflow";
  const runId = getWorkflowMetadata().workflowRunId;
  return extractReferenceCardStep(input, runId);
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

async function extractReferenceCardStep(
  input: ReferenceCardWorkflowInput,
  runId: string,
): Promise<ReferenceCardWorkflowResult> {
  "use step";

  const tpl = defaultPrompts.find((p) => p.id === "prompt-reference-card")!;
  const userPrompt = renderTemplate(tpl.userPromptTemplate, {
    field: input.field || "（未設定）",
    researchQuestion: input.researchQuestion || "（未設定）",
    sourceText: input.sourceText.slice(0, 14000),
  });
  const formatNote = `\n\n出力は次のJSON形式（余計な文字は禁止）：\n${tpl.outputFormat}`;

  const result = await runAiStep(
    {
      messages: [
        { role: "system", content: tpl.systemPrompt },
        { role: "user", content: userPrompt + formatNote },
      ],
      maxTokens: 2500,
      maxAttempts: 2,
    },
    (raw) => {
      const parsed = safeJsonParse<any>(raw);
      if (!parsed || typeof parsed !== "object") return null;
      const c = (parsed.card ?? {}) as Record<string, unknown>;
      const card: ReferenceCard = {
        refKind: str(c.refKind),
        purpose: str(c.purpose),
        method: str(c.method),
        findings: str(c.findings),
        contribution: str(c.contribution),
        limitations: str(c.limitations),
        relationToThis: str(c.relationToThis),
      };
      const reference: Reference = {
        id: makeId("ref"),
        title: str(parsed.title) || input.sourceFilename || "無題の文献",
        author: str(parsed.author),
        source: str(parsed.source),
        year: str(parsed.year),
        notes: undefined,
        card,
      };
      return reference;
    },
  );

  if (!result.parsed) {
    return {
      ok: false,
      error: result.timedOut
        ? "文献カルテの抽出が制限時間内に完了しませんでした。ページ数の少ないPDFで試すか、本文を短くしてください。"
        : "AI出力をJSONとして解釈できませんでした。もう一度お試しください。",
      raw: result.raw,
      meta: { model: result.model, provider: result.provider, attempts: result.attempts, runId },
    };
  }
  return {
    ok: true,
    reference: result.parsed,
    meta: { model: result.model, provider: result.provider, attempts: result.attempts, runId },
  };
}
