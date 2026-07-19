import { getWorkflowMetadata } from "workflow";
import { defaultPrompts } from "@/lib/samples";
import { renderTemplate } from "@/lib/promptVars";
import { safeJsonParse } from "@/lib/json";
import { runAiStep } from "./shared";

/**
 * 論文モードの派生出力:
 *  - 要旨（アブストラクト）: 本文要点 → { abstract, keywords }
 *  - 予稿（4〜8p の短縮版）: 本文要点 → Markdown 本文
 * どちらもクライアントで作ったコンパクトな要約を受け取り、1回のAI呼び出しで生成する。
 */

type Meta = { model: string; provider: string; attempts: number; runId: string };

export type AbstractInput = { paperMeta: string; summary: string };
export type AbstractResult =
  | { ok: true; abstract: string; keywords: string; meta: Meta }
  | { ok: false; error: string; meta: Meta };

export async function abstractWorkflow(input: AbstractInput): Promise<AbstractResult> {
  "use workflow";
  const runId = getWorkflowMetadata().workflowRunId;
  return abstractStep(input, runId);
}

async function abstractStep(input: AbstractInput, runId: string): Promise<AbstractResult> {
  "use step";
  const tpl = defaultPrompts.find((p) => p.id === "prompt-abstract-paper")!;
  const userPrompt = renderTemplate(tpl.userPromptTemplate, {
    paperMeta: input.paperMeta,
    summary: input.summary.slice(0, 16000),
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
      const parsed = safeJsonParse<{ abstract?: unknown; keywords?: unknown }>(raw);
      if (!parsed) return null;
      const abstract = typeof parsed.abstract === "string" ? parsed.abstract.trim() : "";
      if (!abstract) return null;
      const keywords = typeof parsed.keywords === "string" ? parsed.keywords.trim() : "";
      return { abstract, keywords };
    },
  );
  const meta: Meta = {
    model: result.model,
    provider: result.provider,
    attempts: result.attempts,
    runId,
  };
  if (!result.parsed) {
    return { ok: false, error: "要旨の生成に失敗しました。もう一度お試しください。", meta };
  }
  return { ok: true, abstract: result.parsed.abstract, keywords: result.parsed.keywords, meta };
}

export type PreprintInput = { paperMeta: string; summary: string };
export type PreprintResult =
  | { ok: true; preprint: string; meta: Meta }
  | { ok: false; error: string; meta: Meta };

export async function preprintWorkflow(input: PreprintInput): Promise<PreprintResult> {
  "use workflow";
  const runId = getWorkflowMetadata().workflowRunId;
  return preprintStep(input, runId);
}

async function preprintStep(input: PreprintInput, runId: string): Promise<PreprintResult> {
  "use step";
  const tpl = defaultPrompts.find((p) => p.id === "prompt-preprint-paper")!;
  const userPrompt = renderTemplate(tpl.userPromptTemplate, {
    paperMeta: input.paperMeta,
    summary: input.summary.slice(0, 24000),
  });
  // AI層（generateJson）は常にJSON出力を強制するため、予稿もJSON {preprint} で受け取る。
  // 生Markdownを期待すると、強制されたJSONがそのまま本文として保存されてしまう（＝JSONが出力される不具合）。
  const formatNote = `\n\n出力は次のJSON形式（余計な文字は禁止。本文の改行は \\n でエスケープ）：\n${tpl.outputFormat}`;
  const result = await runAiStep(
    {
      messages: [
        { role: "system", content: tpl.systemPrompt },
        { role: "user", content: userPrompt + formatNote },
      ],
      maxTokens: 12000, // 4〜8ページ分の出力
      maxAttempts: 2,
    },
    (raw) => {
      const parsed = safeJsonParse<{ preprint?: unknown }>(raw);
      let text = parsed && typeof parsed.preprint === "string" ? parsed.preprint.trim() : "";
      // 保険: JSONとして取れず、かつ生Markdownが直接返ったケースだけ救済する。
      // JSONっぽい（`{`始まり）ものは採用しない＝JSONが本文に混入する不具合の再発を防ぎ、失敗扱いで再試行させる。
      if (!text) {
        const stripped = (raw ?? "")
          .trim()
          .replace(/^```(?:markdown|md)?\s*/i, "")
          .replace(/```\s*$/, "")
          .trim();
        if (stripped && !stripped.startsWith("{")) text = stripped;
      }
      if (text.length < 200) return null; // 極端に短い＝失敗
      return { preprint: text };
    },
  );
  const meta: Meta = {
    model: result.model,
    provider: result.provider,
    attempts: result.attempts,
    runId,
  };
  if (!result.parsed) {
    return {
      ok: false,
      error: result.timedOut
        ? "予稿の生成が時間内に完了しませんでした。もう一度お試しください。"
        : "予稿の生成に失敗しました。もう一度お試しください。",
      meta,
    };
  }
  return { ok: true, preprint: result.parsed.preprint, meta };
}
