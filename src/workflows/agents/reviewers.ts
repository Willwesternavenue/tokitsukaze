/**
 * P2: 本文生成後に走る 4 エージェント。
 * 各 step は "use step" で個別に retry / observability される。
 * どれかが失敗しても他は結果を返せるよう、内部で try/catch + parseFailed で吸収する。
 */

import type {
  AgentFinding,
  AgentKey,
  AgentReportSummary,
  Chapter,
  Project,
  Section,
  SectionDraft,
} from "@/lib/types";
import { defaultPrompts } from "@/lib/samples";
import { renderTemplate } from "@/lib/promptVars";
import { safeJsonParse } from "@/lib/json";
import { runAiStep } from "../shared";

type AgentDef = {
  key: AgentKey;
  label: string;
  promptId: string;
  buildVars: (ctx: AgentContext) => Record<string, string>;
};

type AgentContext = {
  draft: SectionDraft;
  project: Project;
  chapter?: Chapter;
  section?: Section;
};

async function runReviewer(
  def: AgentDef,
  ctx: AgentContext,
  runId: string,
): Promise<AgentReportSummary> {
  const tpl = defaultPrompts.find((p) => p.id === def.promptId);
  if (!tpl) {
    return {
      agent: def.key,
      label: def.label,
      findings: [],
      meta: { model: "n/a", runId, parseFailed: true },
    };
  }

  const userPrompt = renderTemplate(tpl.userPromptTemplate, def.buildVars(ctx));
  const formatNote = `\n\n出力は次のJSON形式（余計な文字は禁止）：\n${tpl.outputFormat}`;

  try {
    const result = await runAiStep(
      {
        messages: [
          { role: "system", content: tpl.systemPrompt },
          { role: "user", content: userPrompt + formatNote },
        ],
        maxTokens: 2000,
        maxAttempts: 1, // reviewer は 1 発勝負。失敗しても本文生成は成功扱いにする
      },
      (raw) => {
        const parsed = safeJsonParse<{ findings?: unknown }>(raw);
        if (!parsed) return null;
        const arr = Array.isArray((parsed as any).findings) ? (parsed as any).findings : [];
        const findings = arr.map(normalizeFinding).filter((x: AgentFinding | null): x is AgentFinding => !!x);
        return { findings };
      },
    );

    return {
      agent: def.key,
      label: def.label,
      findings: result.parsed?.findings ?? [],
      meta: {
        model: result.model,
        runId,
        parseFailed: !result.parsed,
      },
    };
  } catch (e) {
    console.warn(`[agent:${def.key}] step failed`, e);
    return {
      agent: def.key,
      label: def.label,
      findings: [],
      meta: { model: "n/a", runId, parseFailed: true },
    };
  }
}

function normalizeFinding(f: any): AgentFinding | null {
  if (!f || typeof f !== "object") return null;
  const message = typeof f.message === "string" ? f.message.trim() : "";
  if (!message) return null;
  const raw = typeof f.severity === "string" ? f.severity.toLowerCase() : "";
  const severity: AgentFinding["severity"] =
    raw === "error" ? "error" : raw === "info" ? "info" : "warning";
  const loc = typeof f.loc === "string" ? f.loc : undefined;
  return { severity, message, loc };
}

// ==========================================================
// Reviewer definitions
// ==========================================================

const PROOFREADER: AgentDef = {
  key: "proofreader",
  label: "校正",
  promptId: "prompt-agent-proofreader",
  buildVars: (ctx) => ({
    body: ctx.draft.body,
    styleRules: (ctx.project.writingMemory?.styleRules ?? []).join("\n- "),
  }),
};

const STYLE_GUARDIAN: AgentDef = {
  key: "style-guardian",
  label: "文体",
  promptId: "prompt-agent-style-guardian",
  buildVars: (ctx) => ({
    body: ctx.draft.body,
    desiredTone: ctx.project.desiredTone,
    styleRules: (ctx.project.writingMemory?.styleRules ?? []).join("\n- "),
  }),
};

const CONSISTENCY_LITE: AgentDef = {
  key: "consistency-lite",
  label: "整合性",
  promptId: "prompt-agent-consistency-lite",
  buildVars: (ctx) => ({
    body: ctx.draft.body,
    chapterNumber: String(ctx.chapter?.chapterNumber ?? 0),
    chapterTitle: ctx.chapter?.title ?? ctx.draft.chapterTitle,
    sectionTitle: ctx.section?.title ?? ctx.draft.sectionTitle,
    writingMemory: JSON.stringify(ctx.project.writingMemory ?? {}, null, 2),
    previousChapterSummaries:
      ctx.project.generatedSections
        .filter((d) => d.chapterId !== ctx.draft.chapterId)
        .map((d) => `■ ${d.chapterTitle} / ${d.sectionTitle}\n${d.body.slice(0, 240)}`)
        .join("\n\n") || "（まだ生成済みの他の章なし）",
    outlineSummary: ctx.project.selectedOutline
      ? `${ctx.project.selectedOutline.title}：${ctx.project.selectedOutline.concept}`
      : "",
  }),
};

const READER_EXPERIENCE: AgentDef = {
  key: "reader-experience",
  label: "読者体験",
  promptId: "prompt-agent-reader-experience",
  buildVars: (ctx) => ({
    body: ctx.draft.body,
    chapterNumber: String(ctx.chapter?.chapterNumber ?? 0),
    chapterTitle: ctx.chapter?.title ?? ctx.draft.chapterTitle,
    sectionTitle: ctx.section?.title ?? ctx.draft.sectionTitle,
    targetReader: ctx.project.targetReader,
    desiredTone: ctx.project.desiredTone,
  }),
};

// ==========================================================
// Step functions (workflow から並列で呼ばれる)
// ==========================================================

export async function proofreaderStep(
  ctx: AgentContext,
  runId: string,
): Promise<AgentReportSummary> {
  "use step";
  return runReviewer(PROOFREADER, ctx, runId);
}

export async function styleGuardianStep(
  ctx: AgentContext,
  runId: string,
): Promise<AgentReportSummary> {
  "use step";
  return runReviewer(STYLE_GUARDIAN, ctx, runId);
}

export async function consistencyLiteStep(
  ctx: AgentContext,
  runId: string,
): Promise<AgentReportSummary> {
  "use step";
  return runReviewer(CONSISTENCY_LITE, ctx, runId);
}

export async function readerExperienceStep(
  ctx: AgentContext,
  runId: string,
): Promise<AgentReportSummary> {
  "use step";
  return runReviewer(READER_EXPERIENCE, ctx, runId);
}
