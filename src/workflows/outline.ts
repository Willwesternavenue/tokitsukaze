import { getWorkflowMetadata } from "workflow";
import type { OutlineProposal, OutlineType, PromptTemplate, Chapter, Section } from "@/lib/types";
import { defaultPrompts } from "@/lib/samples";
import { renderTemplate } from "@/lib/promptVars";
import { safeJsonParse } from "@/lib/json";
import { makeId } from "@/lib/ids";
import { runAiStep } from "./shared";

export type OutlineWorkflowInput = {
  projectName: string;
  intervieweeName: string;
  theme: string;
  targetReader: string;
  desiredTone: string;
  interviewNotes: string;
  promptTemplate?: PromptTemplate;
};

export type OutlineWorkflowResult = {
  ok: true;
  proposals: OutlineProposal[];
  meta: { model: string; provider: string; attempts: number; runId: string };
} | {
  ok: false;
  error: string;
  raw?: string;
  meta: { model: string; provider: string; attempts: number; runId: string };
};

/**
 * P1: 現行 generate-outline のロジックをそのまま step 内で実行する 1-step workflow。
 * P2 で proposals ごとに Structure Analyzer 等の step を追加していく。
 */
export async function outlineWorkflow(input: OutlineWorkflowInput): Promise<OutlineWorkflowResult> {
  "use workflow";
  const runId = getWorkflowMetadata().workflowRunId;
  const { model, provider, attempts, proposals, raw, error } = await outlineStep(input);
  if (proposals && proposals.length > 0) {
    return { ok: true, proposals, meta: { model, provider, attempts, runId } };
  }
  return {
    ok: false,
    error: error ?? "構成案を生成できませんでした。",
    raw,
    meta: { model, provider, attempts, runId },
  };
}

async function outlineStep(input: OutlineWorkflowInput) {
  "use step";

  const tpl = input.promptTemplate || defaultPrompts.find((d) => d.id === "prompt-outline")!;
  const systemPrompt = tpl.systemPrompt;
  const userPrompt = renderTemplate(tpl.userPromptTemplate, {
    projectName: input.projectName ?? "",
    intervieweeName: input.intervieweeName ?? "",
    theme: input.theme ?? "",
    targetReader: input.targetReader ?? "",
    desiredTone: input.desiredTone ?? "",
    interviewNotes: input.interviewNotes,
  });
  const formatNote = `\n\n出力は次のJSON形式で返してください（余計な文字は禁止）。\n${tpl.outputFormat}`;

  const result = await runAiStep(
    {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt + formatNote },
      ],
      maxTokens: 16000,
      maxAttempts: 2,
    },
    (raw) => {
      const parsed = safeJsonParse<{ proposals?: unknown }>(raw);
      if (!parsed) return null;
      const proposals = normalizeProposals((parsed as any).proposals ?? parsed);
      return proposals.length > 0 ? { proposals } : null;
    },
  );

  if (!result.parsed) {
    return {
      model: result.model,
      provider: result.provider,
      attempts: result.attempts,
      proposals: [] as OutlineProposal[],
      raw: result.raw,
      error: `AI出力をJSONとして解釈できませんでした (${result.attempts}回試行)。`,
    };
  }
  return {
    model: result.model,
    provider: result.provider,
    attempts: result.attempts,
    proposals: result.parsed.proposals,
    raw: undefined,
    error: undefined,
  };
}

// ==== normalize helpers (現行 API route から移植) ====

const VALID_TYPES: OutlineType[] = ["chronological", "thematic", "narrative"];

function normalizeType(raw: unknown, idx: number): OutlineType {
  const s = typeof raw === "string" ? raw.toLowerCase() : "";
  if ((VALID_TYPES as string[]).includes(s)) return s as OutlineType;
  if (s.includes("時系列") || s.includes("chrono") || s.includes("課題")) return "chronological";
  if (s.includes("テーマ") || s.includes("thema") || s.includes("フレームワーク") || s.includes("framework"))
    return "thematic";
  if (s.includes("人物") || s.includes("narrat") || s.includes("読み物") || s.includes("ストーリー") || s.includes("story"))
    return "narrative";
  return VALID_TYPES[Math.min(idx, VALID_TYPES.length - 1)];
}

function normalizeSections(raw: unknown): Section[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((s: any, i: number): Section | null => {
      const title = typeof s?.title === "string" ? s.title : "";
      if (!title) return null;
      return {
        id: typeof s?.id === "string" && s.id ? s.id : `section-${i + 1}-${makeId("s")}`,
        title,
        summary: typeof s?.summary === "string" ? s.summary : undefined,
      };
    })
    .filter((x): x is Section => !!x);
}

function normalizeChapters(raw: unknown): Chapter[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((c: any, i: number): Chapter | null => {
      const title = typeof c?.title === "string" ? c.title : "";
      if (!title) return null;
      return {
        id: typeof c?.id === "string" && c.id ? c.id : `chapter-${i + 1}-${makeId("c")}`,
        chapterNumber: typeof c?.chapterNumber === "number" ? c.chapterNumber : i + 1,
        title,
        summary: typeof c?.summary === "string" ? c.summary : "",
        sections: normalizeSections(c?.sections),
      };
    })
    .filter((x): x is Chapter => !!x);
}

function normalizeProposals(raw: unknown): OutlineProposal[] {
  const arr = Array.isArray(raw) ? raw : [];
  return arr
    .map((p: any, i: number): OutlineProposal | null => {
      const title = typeof p?.title === "string" ? p.title : "";
      const chapters = normalizeChapters(p?.chapters);
      if (!title || chapters.length === 0) return null;
      return {
        id: typeof p?.id === "string" && p.id ? p.id : `outline-${i + 1}-${makeId("o")}`,
        title,
        type: normalizeType(p?.type, i),
        concept: typeof p?.concept === "string" ? p.concept : "",
        recommendedFor: typeof p?.recommendedFor === "string" ? p.recommendedFor : "",
        chapters,
      };
    })
    .filter((x): x is OutlineProposal => !!x);
}
