import { getWorkflowMetadata } from "workflow";
import type { TermPair } from "@/lib/types";
import { defaultPrompts } from "@/lib/samples";
import { renderTemplate } from "@/lib/promptVars";
import { safeJsonParse } from "@/lib/json";
import { makeId } from "@/lib/ids";
import { runAiStep } from "./shared";

/**
 * 翻訳書モード: 翻訳済みセグメントの原文・訳文ペアから対訳表の候補を抽出する。
 * 抽出結果は status:"candidate" で返し、/terms 画面で人が confirmed に昇格させる。
 * （論文の翻訳も翻訳書モード workType="paper" でこの仕組みに乗る）
 */

export type TermsWorkflowInput = {
  /** 原文・訳文ペア（翻訳済みセグメントから。クライアントで文字数を絞って渡す） */
  pairs: { source: string; target: string }[];
  /** 既存の対訳表（重複抽出を避けるためプロンプトに渡す） */
  existingTerms: { source: string; target: string }[];
};

export type TermsWorkflowResult =
  | {
      ok: true;
      terms: TermPair[];
      meta: { model: string; provider: string; attempts: number; runId: string };
    }
  | {
      ok: false;
      error: string;
      raw?: string;
      meta: { model: string; provider: string; attempts: number; runId: string };
    };

export async function extractTermsWorkflow(
  input: TermsWorkflowInput,
): Promise<TermsWorkflowResult> {
  "use workflow";
  const runId = getWorkflowMetadata().workflowRunId;
  return extractTermsStep(input, runId);
}

async function extractTermsStep(
  input: TermsWorkflowInput,
  runId: string,
): Promise<TermsWorkflowResult> {
  "use step";

  const tpl = defaultPrompts.find((p) => p.id === "prompt-terms-extract")!;

  const pairsText = input.pairs
    .map(
      (p, i) =>
        `=== ペア${i + 1} ===\n【原文】\n${p.source.slice(0, 2400)}\n【訳文】\n${p.target.slice(0, 2400)}`,
    )
    .join("\n\n");
  const existingText =
    input.existingTerms.length > 0
      ? input.existingTerms.map((t) => `- ${t.source} → ${t.target}`).join("\n")
      : "（まだ登録なし）";

  const userPrompt = renderTemplate(tpl.userPromptTemplate, {
    pairs: pairsText,
    existingTerms: existingText,
  });
  const formatNote = `\n\n出力は次のJSON形式（余計な文字は禁止）：\n${tpl.outputFormat}`;

  const result = await runAiStep(
    {
      messages: [
        { role: "system", content: tpl.systemPrompt },
        { role: "user", content: userPrompt + formatNote },
      ],
      maxTokens: 4000,
      maxAttempts: 2,
    },
    (raw) => {
      const parsed = safeJsonParse<{ terms?: unknown }>(raw);
      if (!parsed) return null;
      const arr = Array.isArray((parsed as any).terms) ? (parsed as any).terms : null;
      if (!arr) return null;
      const terms: TermPair[] = arr
        .filter(
          (t: any) =>
            t &&
            typeof t.source === "string" &&
            t.source.trim() &&
            typeof t.target === "string" &&
            t.target.trim(),
        )
        .slice(0, 30)
        .map((t: any) => ({
          id: makeId("term"),
          source: t.source.trim(),
          target: t.target.trim(),
          variants: Array.isArray(t.variants)
            ? t.variants.filter((v: unknown): v is string => typeof v === "string" && !!v.trim())
            : [],
          notes: typeof t.notes === "string" && t.notes.trim() ? t.notes.trim() : undefined,
          status: "candidate" as const,
        }));
      return { terms };
    },
  );

  if (!result.parsed) {
    return {
      ok: false,
      error: result.timedOut
        ? "用語抽出が制限時間内に完了しませんでした。ペア数を減らして再実行してください。"
        : "AI出力をJSONとして解釈できませんでした。もう一度お試しください。",
      raw: result.raw,
      meta: { model: result.model, provider: result.provider, attempts: result.attempts, runId },
    };
  }
  return {
    ok: true,
    terms: result.parsed.terms,
    meta: { model: result.model, provider: result.provider, attempts: result.attempts, runId },
  };
}
