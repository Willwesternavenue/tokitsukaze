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

// ===== 聞き書き用: 校閲（事実確認） =====

const FACT_CHECK: AgentDef = {
  key: "fact-check",
  label: "校閲",
  promptId: "prompt-agent-fact-check",
  buildVars: (ctx) => ({
    body: ctx.draft.body,
    interviewNotes: (ctx.project.interviewNotes ?? "").slice(0, 8000),
    writingMemory: JSON.stringify(ctx.project.writingMemory ?? {}, null, 2),
  }),
};

// ===== ビジネス書用: 論理構成チェック / 出典チェック =====

const LOGIC_CHECK: AgentDef = {
  key: "logic-check",
  label: "論理構成",
  promptId: "prompt-agent-logic",
  buildVars: (ctx) => ({
    body: ctx.draft.body,
    chapterNumber: String(ctx.chapter?.chapterNumber ?? 0),
    chapterTitle: ctx.chapter?.title ?? ctx.draft.chapterTitle,
    sectionTitle: ctx.section?.title ?? ctx.draft.sectionTitle,
    outlineSummary: ctx.project.selectedOutline
      ? `${ctx.project.selectedOutline.title}：${ctx.project.selectedOutline.concept}`
      : "",
  }),
};

function serializeReferences(ctx: AgentContext): string {
  const refs = ctx.project.references ?? [];
  if (refs.length === 0) return "（参考文献が未登録です）";
  return refs
    .map(
      (r) =>
        `- ${r.title}${r.author ? ` / ${r.author}` : ""}${r.source ? `（${r.source}）` : ""}${
          r.year ? ` ${r.year}` : ""
        }${r.notes ? ` — ${r.notes}` : ""}`,
    )
    .join("\n");
}

function serializeGlossary(ctx: AgentContext): string {
  const terms = ctx.project.glossary ?? [];
  if (terms.length === 0) return "（用語集なし）";
  return terms.map((t) => `- ${t.term}: ${t.definition}`).join("\n");
}

const CITATION_CHECK: AgentDef = {
  key: "citation-check",
  label: "出典",
  promptId: "prompt-agent-citation",
  buildVars: (ctx) => ({
    body: ctx.draft.body,
    references: serializeReferences(ctx),
    glossary: serializeGlossary(ctx),
  }),
};

// ===== ブログ用: SEO・検索意図チェック =====

function serializeBlogSeo(ctx: AgentContext): string {
  const m = ctx.project.blogMeta;
  if (!m) return "（SEO設定なし）";
  return [
    `対策キーワード: ${m.targetKeyword || "未設定"}`,
    m.secondaryKeywords?.length ? `関連キーワード: ${m.secondaryKeywords.join("、")}` : "",
    `検索意図: ${m.searchIntent || "未設定"}`,
    `想定読者: ${m.persona || "未設定"}`,
  ]
    .filter(Boolean)
    .join("\n");
}

const SEO_CHECK: AgentDef = {
  key: "seo-check",
  label: "SEO・検索意図",
  promptId: "prompt-agent-seo",
  buildVars: (ctx) => ({
    body: ctx.draft.body,
    seoContext: serializeBlogSeo(ctx),
  }),
};

// ===== 脚本用: フォーマットチェック / 尺・テンポチェック =====

import { mediaTypeLabel } from "@/lib/genreConfig";

function serializeSceneMeta(ctx: AgentContext): string {
  const meta = ctx.section?.sceneMeta;
  if (!meta) return "（sceneMeta 未設定）";
  return [
    `intExt: ${meta.intExt}`,
    `location: ${meta.location}`,
    `timeOfDay: ${meta.timeOfDay}`,
    meta.estimatedMinutes != null ? `estimatedMinutes: ${meta.estimatedMinutes}` : "",
    meta.presentCharacters?.length ? `presentCharacters: ${meta.presentCharacters.join("、")}` : "",
    meta.purpose ? `purpose: ${meta.purpose}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

const SCREENPLAY_FORMAT: AgentDef = {
  key: "format-check",
  label: "フォーマット",
  promptId: "prompt-agent-screenplay-format",
  buildVars: (ctx) => ({
    body: ctx.draft.body,
    sceneMeta: serializeSceneMeta(ctx),
    mediaType: mediaTypeLabel(ctx.project.screenplayMeta?.mediaType),
  }),
};

const RUNTIME_CHECK: AgentDef = {
  key: "runtime-check",
  label: "尺・テンポ",
  promptId: "prompt-agent-runtime",
  buildVars: (ctx) => ({
    body: ctx.draft.body,
    bodyChars: String(ctx.draft.body.length),
    sceneMeta: serializeSceneMeta(ctx),
    mediaType: mediaTypeLabel(ctx.project.screenplayMeta?.mediaType),
    targetRuntime: String(ctx.project.screenplayMeta?.targetRuntimeMinutes ?? "未設定"),
  }),
};

// ===== P3: Novel-only reviewers =====

function serializeCharacters(project: Project): string {
  const chars = project.characters ?? [];
  if (chars.length === 0) return "（登場人物が未登録です）";
  return chars
    .map((c) => {
      const arc = c.arc
        ? `arc: start=${c.arc.start}${c.arc.turningPoint ? ` / turn=${c.arc.turningPoint}` : ""}${c.arc.end ? ` / end=${c.arc.end}` : ""}`
        : "";
      return [
        `● ${c.name}（${c.role}）`,
        c.profile ? `  profile: ${c.profile}` : "",
        c.desire ? `  desire (欲): ${c.desire}` : "",
        c.need ? `  need (真に必要): ${c.need}` : "",
        c.wound ? `  wound: ${c.wound}` : "",
        c.contradiction ? `  contradiction: ${c.contradiction}` : "",
        c.voice ? `  voice: ${c.voice}` : "",
        c.tabooWords?.length ? `  taboo: ${c.tabooWords.join("、")}` : "",
        arc ? `  ${arc}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

const CHARACTER_VOICE: AgentDef = {
  key: "character-voice",
  label: "キャラクター",
  promptId: "prompt-agent-character-voice",
  buildVars: (ctx) => ({
    body: ctx.draft.body,
    characters: serializeCharacters(ctx.project),
    chapterNumber: String(ctx.chapter?.chapterNumber ?? 0),
    chapterTitle: ctx.chapter?.title ?? ctx.draft.chapterTitle,
    sectionTitle: ctx.section?.title ?? ctx.draft.sectionTitle,
  }),
};

const TENSION: AgentDef = {
  key: "tension-checker",
  label: "緊張感",
  promptId: "prompt-agent-tension",
  buildVars: (ctx) => ({
    body: ctx.draft.body,
    chapterNumber: String(ctx.chapter?.chapterNumber ?? 0),
    chapterTitle: ctx.chapter?.title ?? ctx.draft.chapterTitle,
    sectionTitle: ctx.section?.title ?? ctx.draft.sectionTitle,
    outlineSummary: ctx.project.selectedOutline
      ? `${ctx.project.selectedOutline.title}：${ctx.project.selectedOutline.concept}`
      : "",
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

export async function factCheckStep(
  ctx: AgentContext,
  runId: string,
): Promise<AgentReportSummary> {
  "use step";
  return runReviewer(FACT_CHECK, ctx, runId);
}

export async function logicCheckStep(
  ctx: AgentContext,
  runId: string,
): Promise<AgentReportSummary> {
  "use step";
  return runReviewer(LOGIC_CHECK, ctx, runId);
}

export async function citationCheckStep(
  ctx: AgentContext,
  runId: string,
): Promise<AgentReportSummary> {
  "use step";
  return runReviewer(CITATION_CHECK, ctx, runId);
}

// ===== P3: novel-only =====

export async function characterVoiceStep(
  ctx: AgentContext,
  runId: string,
): Promise<AgentReportSummary> {
  "use step";
  return runReviewer(CHARACTER_VOICE, ctx, runId);
}

export async function tensionStep(
  ctx: AgentContext,
  runId: string,
): Promise<AgentReportSummary> {
  "use step";
  return runReviewer(TENSION, ctx, runId);
}

// ===== 脚本専用 =====

export async function screenplayFormatStep(
  ctx: AgentContext,
  runId: string,
): Promise<AgentReportSummary> {
  "use step";
  return runReviewer(SCREENPLAY_FORMAT, ctx, runId);
}

export async function runtimeCheckStep(
  ctx: AgentContext,
  runId: string,
): Promise<AgentReportSummary> {
  "use step";
  return runReviewer(RUNTIME_CHECK, ctx, runId);
}

// ===== ブログ専用 =====

export async function seoCheckStep(
  ctx: AgentContext,
  runId: string,
): Promise<AgentReportSummary> {
  "use step";
  return runReviewer(SEO_CHECK, ctx, runId);
}
