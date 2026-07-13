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
  ReferenceWork,
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
  referenceWorks?: ReferenceWork[]; // 参照ライブラリで選択された作品カルテ
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
    genreNote:
      ctx.project.genre === "paper"
        ? "【論文モードの注意】外部知識との真偽の断定ではなく、本文内の主張・数字・因果関係の不自然さ・矛盾の検出を主目的とすること（素材との照合が主、一般知識は従）。"
        : "",
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
    genreNote:
      ctx.project.genre === "paper"
        ? '【論文モードの追加確認】(1) 本文中の引用マーカー〔著者, 年〕が上の参考文献リストに存在するか突き合わせ、存在しない引用は severity="error" で指摘する。(2) 〔要出典〕が残っていれば出典の追加が必要として指摘する。(3) 文献の実在確認・外部DBとの照合は行わない。'
        : "",
  }),
};

// ===== 参照ライブラリ: 重複チェック / 一貫性チェック =====

function serializeReferenceClaims(ctx: AgentContext): string {
  const works = ctx.referenceWorks ?? [];
  if (works.length === 0) return "（参照作品なし）";
  return works
    .map(
      (w) =>
        `■ ${w.title}（${w.kind === "own" ? "自作" : "参照"}）\n` +
        `  要約: ${w.summary}\n` +
        (w.keyClaims.length ? `  既出の主張: ${w.keyClaims.join(" / ")}` : ""),
    )
    .join("\n\n");
}

function serializeReferenceCanon(ctx: AgentContext): string {
  const works = ctx.referenceWorks ?? [];
  if (works.length === 0) return "（参照作品なし）";
  return works
    .map((w) => {
      const chars = (w.characters ?? [])
        .map(
          (c) =>
            `    ・${c.name}（口調: ${c.voice || "不明"}）` +
            (c.keyLines.length ? ` 過去セリフ: ${c.keyLines.map((l) => `「${l}」`).join("、")}` : ""),
        )
        .join("\n");
      return (
        `■ ${w.title}\n` +
        (w.canonFacts.length ? `  確定設定: ${w.canonFacts.join(" / ")}\n` : "") +
        (chars ? `  登場人物:\n${chars}` : "")
      );
    })
    .join("\n\n");
}

const REPETITION_CHECK: AgentDef = {
  key: "repetition-check",
  label: "重複",
  promptId: "prompt-agent-repetition",
  buildVars: (ctx) => ({
    body: ctx.draft.body,
    referenceClaims: serializeReferenceClaims(ctx),
  }),
};

const CONTINUITY_CHECK: AgentDef = {
  key: "continuity-check",
  label: "一貫性（過去作）",
  promptId: "prompt-agent-continuity",
  buildVars: (ctx) => ({
    body: ctx.draft.body,
    referenceCanon: serializeReferenceCanon(ctx),
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

// ===== ニュース用: 見出し・リード整合チェック / 中立性・両論チェック =====

import { newsTypeLabel, paperTypeLabel } from "@/lib/genreConfig";

function serializeNewsMeta(ctx: AgentContext): string {
  const m = ctx.project.newsMeta;
  if (!m) return "（記事仕様なし）";
  return [
    `想定媒体: ${m.outlet || "未設定"}`,
    `記事種別: ${newsTypeLabel(m.newsType)}`,
    `切り口・アングル: ${m.angle || "未設定"}`,
    `想定読者: ${m.audience || "未設定"}`,
    m.headlineDraft ? `見出し案（現在）: ${m.headlineDraft}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

const HEADLINE_LEAD_CHECK: AgentDef = {
  key: "headline-lead-check",
  label: "見出し・リード",
  promptId: "prompt-agent-headline-lead",
  buildVars: (ctx) => ({
    body: ctx.draft.body,
    chapterTitle: ctx.chapter?.title ?? ctx.draft.chapterTitle,
    sectionTitle: ctx.section?.title ?? ctx.draft.sectionTitle,
    newsContext: serializeNewsMeta(ctx),
  }),
};

const NEUTRALITY_CHECK: AgentDef = {
  key: "neutrality-check",
  label: "中立性",
  promptId: "prompt-agent-neutrality",
  buildVars: (ctx) => ({
    body: ctx.draft.body,
    newsContext: serializeNewsMeta(ctx),
  }),
};

// ===== 論文用: 簡易査読 =====

function serializePaperMeta(ctx: AgentContext): string {
  const m = ctx.project.paperMeta;
  if (!m) return "（論文仕様なし）";
  return [
    `論文種別: ${paperTypeLabel(m.paperType)}`,
    `分野: ${m.field || "未設定"}`,
    `リサーチクエスチョン・仮説: ${m.researchQuestion || "未設定"}`,
    `主張したい貢献・新規性: ${m.contributions || "未設定"}`,
    `想定投稿先・読者: ${m.venue || "未設定"}`,
    m.keywords ? `キーワード: ${m.keywords}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

const PEER_REVIEW: AgentDef = {
  key: "peer-review",
  label: "簡易査読",
  promptId: "prompt-agent-peer-review",
  buildVars: (ctx) => ({
    body: ctx.draft.body,
    chapterNumber: String(ctx.chapter?.chapterNumber ?? 0),
    chapterTitle: ctx.chapter?.title ?? ctx.draft.chapterTitle,
    sectionTitle: ctx.section?.title ?? ctx.draft.sectionTitle,
    paperContext: serializePaperMeta(ctx),
    references: serializeReferences(ctx),
  }),
};

// ===== 翻訳書用: 訳抜け / 用語統一 / 表記揺れ =====
// （sourceText は Section.sourceText から取る）

function serializeTermPairs(ctx: AgentContext): string {
  const terms = ctx.project.termPairs ?? [];
  if (terms.length === 0) return "（対訳表が未登録です）";
  // confirmed を優先し、プロンプト肥大を避けるため上限を設ける
  const sorted = [...terms].sort((a, b) =>
    a.status === b.status ? 0 : a.status === "confirmed" ? -1 : 1,
  );
  return sorted
    .slice(0, 120)
    .map(
      (t) =>
        `- ${t.source} → ${t.target}${t.variants?.length ? `（NG表記: ${t.variants.join("、")}）` : ""}${
          t.notes ? ` — ${t.notes}` : ""
        }${t.status === "candidate" ? "（候補）" : ""}`,
    )
    .join("\n");
}

const OMISSION_CHECK: AgentDef = {
  key: "omission-check",
  label: "訳抜け",
  promptId: "prompt-agent-omission",
  buildVars: (ctx) => ({
    sourceText: ctx.section?.sourceText ?? "（原文なし）",
    body: ctx.draft.body,
  }),
};

const TERMINOLOGY_CHECK: AgentDef = {
  key: "terminology-check",
  label: "用語統一",
  promptId: "prompt-agent-terminology",
  buildVars: (ctx) => ({
    termPairs: serializeTermPairs(ctx),
    sourceText: ctx.section?.sourceText ?? "（原文なし）",
    body: ctx.draft.body,
  }),
};

const ORTHOGRAPHY_CHECK: AgentDef = {
  key: "orthography-check",
  label: "表記揺れ",
  promptId: "prompt-agent-orthography",
  buildVars: (ctx) => ({
    previousBodies:
      ctx.project.generatedSections
        .filter((d) => !(d.chapterId === ctx.draft.chapterId && d.sectionId === ctx.draft.sectionId))
        .slice(-4)
        .map((d) => d.body.slice(0, 800))
        .join("\n---\n") || "（まだ他の訳文なし）",
    body: ctx.draft.body,
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
  // 論文モード: 「事実確認」が外部真偽の保証と誤解されないよう表示名を差し替える（内部キーは不変）
  const def =
    ctx.project.genre === "paper" ? { ...FACT_CHECK, label: "校閲・本文内整合" } : FACT_CHECK;
  return runReviewer(def, ctx, runId);
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

// ===== ニュース専用 =====

export async function headlineLeadCheckStep(
  ctx: AgentContext,
  runId: string,
): Promise<AgentReportSummary> {
  "use step";
  return runReviewer(HEADLINE_LEAD_CHECK, ctx, runId);
}

export async function neutralityCheckStep(
  ctx: AgentContext,
  runId: string,
): Promise<AgentReportSummary> {
  "use step";
  return runReviewer(NEUTRALITY_CHECK, ctx, runId);
}

// ===== 論文専用 =====

export async function peerReviewStep(
  ctx: AgentContext,
  runId: string,
): Promise<AgentReportSummary> {
  "use step";
  return runReviewer(PEER_REVIEW, ctx, runId);
}

// ===== 翻訳書専用 =====

export async function omissionCheckStep(
  ctx: AgentContext,
  runId: string,
): Promise<AgentReportSummary> {
  "use step";
  return runReviewer(OMISSION_CHECK, ctx, runId);
}

export async function terminologyCheckStep(
  ctx: AgentContext,
  runId: string,
): Promise<AgentReportSummary> {
  "use step";
  return runReviewer(TERMINOLOGY_CHECK, ctx, runId);
}

export async function orthographyCheckStep(
  ctx: AgentContext,
  runId: string,
): Promise<AgentReportSummary> {
  "use step";
  return runReviewer(ORTHOGRAPHY_CHECK, ctx, runId);
}

// ===== 参照ライブラリ（全ジャンル・参照作品選択時のみ）=====

export async function repetitionCheckStep(
  ctx: AgentContext,
  runId: string,
): Promise<AgentReportSummary> {
  "use step";
  return runReviewer(REPETITION_CHECK, ctx, runId);
}

export async function continuityCheckStep(
  ctx: AgentContext,
  runId: string,
): Promise<AgentReportSummary> {
  "use step";
  return runReviewer(CONTINUITY_CHECK, ctx, runId);
}
