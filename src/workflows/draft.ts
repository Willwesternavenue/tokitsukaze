import { getWorkflowMetadata } from "workflow";
import type {
  AgentReportSummary,
  Chapter,
  Project,
  PromptTemplate,
  ReferenceWork,
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
  characterVoiceStep,
  citationCheckStep,
  consistencyLiteStep,
  continuityCheckStep,
  factCheckStep,
  headlineLeadCheckStep,
  logicCheckStep,
  neutralityCheckStep,
  omissionCheckStep,
  orthographyCheckStep,
  peerReviewStep,
  proofreaderStep,
  readerExperienceStep,
  repetitionCheckStep,
  runtimeCheckStep,
  screenplayFormatStep,
  seoCheckStep,
  styleGuardianStep,
  tensionStep,
  terminologyCheckStep,
} from "./agents/reviewers";
import { langLabel, mediaTypeLabel, newsTypeLabel, paperTypeLabel, workTypeLabel } from "@/lib/genreConfig";
import {
  authorYearMarker,
  citationInstruction,
  citationStyleLabel,
  DEFAULT_CITATION_STYLE,
} from "@/lib/citation";

export type DraftWorkflowInput = {
  project: Project;
  chapter: Chapter;
  section: Section;
  promptTemplate?: PromptTemplate;
  /** 参照ライブラリで選択された作品カルテ（クライアントから渡す。空なら参照エージェントは走らない） */
  referenceWorks?: ReferenceWork[];
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

  // 2. 本文が成功した時だけエージェントを並列実行
  //    (失敗時のフォールバック本文にレビューをかけても意味がないので skip)
  //    Project.agentToggles で無効化されたレビュアーはスキップ (未設定キーは有効)
  let agentReports: AgentReportSummary[] = [];
  if (result.ok) {
    const ctx = {
      draft: result.draft,
      project: input.project,
      chapter: input.chapter,
      section: input.section,
      referenceWorks: input.referenceWorks ?? [],
    };
    const toggles = input.project.agentToggles ?? {};
    const enabled = (key: keyof typeof toggles) => toggles[key] !== false;

    // 翻訳書: 整合性・読者体験は原稿創作向けの観点なのでスキップし、翻訳専用チェックに置き換える
    const isTranslation = input.project.genre === "translation";

    const steps: Promise<AgentReportSummary>[] = [];
    if (enabled("proofreader")) steps.push(proofreaderStep(ctx, runId));
    if (enabled("style-guardian")) steps.push(styleGuardianStep(ctx, runId));
    if (!isTranslation) {
      if (enabled("consistency-lite")) steps.push(consistencyLiteStep(ctx, runId));
      if (enabled("reader-experience")) steps.push(readerExperienceStep(ctx, runId));
    }
    // 小説・脚本: キャラクター一貫性 + 緊張感
    if (input.project.genre === "novel" || input.project.genre === "screenplay") {
      if (enabled("character-voice")) steps.push(characterVoiceStep(ctx, runId));
      if (enabled("tension-checker")) steps.push(tensionStep(ctx, runId));
    }
    // 実話・実用系 (聞き書き / ビジネス書 / ブログ / ニュース / 論文) は校閲 (事実確認) を追加。創作の小説では不要
    if (
      input.project.genre === "biography" ||
      input.project.genre === "business" ||
      input.project.genre === "blog" ||
      input.project.genre === "news" ||
      input.project.genre === "paper"
    ) {
      if (enabled("fact-check")) steps.push(factCheckStep(ctx, runId));
    }
    // ブログ専任: SEO・検索意図チェック
    if (input.project.genre === "blog") {
      if (enabled("seo-check")) steps.push(seoCheckStep(ctx, runId));
    }
    // ニュース専任: 見出し・リード整合 + 中立性・両論
    if (input.project.genre === "news") {
      if (enabled("headline-lead-check")) steps.push(headlineLeadCheckStep(ctx, runId));
      if (enabled("neutrality-check")) steps.push(neutralityCheckStep(ctx, runId));
    }
    // 翻訳書専任: 訳抜け + 用語統一 + 表記揺れ（論文の翻訳も workType="paper" でこの規律に乗る）
    if (isTranslation) {
      if (enabled("omission-check")) steps.push(omissionCheckStep(ctx, runId));
      if (enabled("terminology-check")) steps.push(terminologyCheckStep(ctx, runId));
      if (enabled("orthography-check")) steps.push(orthographyCheckStep(ctx, runId));
    }
    // ビジネス書・論文: 論理構成チェック + 出典チェック
    if (input.project.genre === "business" || input.project.genre === "paper") {
      if (enabled("logic-check")) steps.push(logicCheckStep(ctx, runId));
      if (enabled("citation-check")) steps.push(citationCheckStep(ctx, runId));
    }
    // 論文専任: 簡易査読
    if (input.project.genre === "paper") {
      if (enabled("peer-review")) steps.push(peerReviewStep(ctx, runId));
    }
    // 脚本専任: フォーマットチェック + 尺・テンポチェック
    if (input.project.genre === "screenplay") {
      if (enabled("format-check")) steps.push(screenplayFormatStep(ctx, runId));
      if (enabled("runtime-check")) steps.push(runtimeCheckStep(ctx, runId));
    }
    // 参照ライブラリ: 参照作品を1件以上選択している時のみ (全ジャンル)
    if ((input.referenceWorks ?? []).length > 0) {
      if (enabled("repetition-check")) steps.push(repetitionCheckStep(ctx, runId));
      if (enabled("continuity-check")) steps.push(continuityCheckStep(ctx, runId));
    }
    agentReports = await Promise.all(steps);
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

  // 翻訳書: 構成順で直前にあたる生成済みセグメントの訳文末尾（文体・用語の接続用）
  const previousTail = findPreviousDraftTail(project, chapter, section);

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
    // ===== 翻訳書モード用の変数（他ジャンルのテンプレでは未使用のまま無害） =====
    sourceText: section.sourceText ?? "",
    sourceLangLabel: langLabel(project.translationMeta?.sourceLang),
    targetLangLabel: langLabel(project.translationMeta?.targetLang),
    previousTail: previousTail || "（最初のセグメントです）",
  });

  // ジャンル別コンテキストを system prompt の末尾に差し込む
  // novel: characters + storyBible / business: 参考文献 + 用語集 / screenplay: キャラ + ロケーション + sceneMeta
  const genreContext =
    project.genre === "novel"
      ? buildNovelContext(project)
      : project.genre === "business"
        ? buildBusinessContext(project)
        : project.genre === "screenplay"
          ? buildScreenplayContext(project, section)
          : project.genre === "blog"
            ? buildBlogContext(project)
            : project.genre === "news"
              ? buildNewsContext(project)
              : project.genre === "translation"
                ? buildTranslationContext(project)
                : project.genre === "paper"
                  ? buildPaperContext(project)
                  : "";
  // 参照ライブラリ（全ジャンル共通・選択作品があれば）
  const refContext = buildReferenceContext(input.referenceWorks ?? [], project.genre);
  const systemPromptFinal =
    tpl.systemPrompt +
    (genreContext ? `\n\n${genreContext}` : "") +
    (refContext ? `\n\n${refContext}` : "");

  const formatNote = `\n\n出力は次のJSON形式（余計な文字は禁止）：\n${tpl.outputFormat}`;

  const result = await runAiStep(
    {
      messages: [
        { role: "system", content: systemPromptFinal },
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

// ビジネス書: 参考文献・用語集を system prompt に注入する
function buildBusinessContext(project: Project): string {
  const refs = project.references ?? [];
  const terms = project.glossary ?? [];
  if (refs.length === 0 && terms.length === 0) return "";
  const parts: string[] = ["【ビジネス書モード：参考文献と用語集】"];
  if (refs.length > 0) {
    parts.push("## 参考文献（登録済み）");
    parts.push(
      refs
        .map(
          (r) =>
            `- ${r.title}${r.author ? ` / ${r.author}` : ""}${r.source ? `（${r.source}）` : ""}${
              r.year ? ` ${r.year}` : ""
            }`,
        )
        .join("\n"),
    );
  }
  if (terms.length > 0) {
    parts.push("## 用語集（この定義に従って用語を使うこと）");
    parts.push(terms.map((t) => `- ${t.term}: ${t.definition}`).join("\n"));
  }
  parts.push(
    "\n【守るべきこと】\n" +
      "- 統計・数値・研究結果を使う場合、上記の参考文献にあるものはそれを根拠として使い、無いものは factCheckPoints に「要出典」として必ず挙げること\n" +
      "- 用語は用語集の定義と矛盾しない使い方をすること",
  );
  return parts.join("\n\n");
}

// 参照ライブラリ: 選択された過去作品カルテを system prompt に注入する（全ジャンル共通）
function buildReferenceContext(works: ReferenceWork[], genre: Project["genre"]): string {
  if (works.length === 0) return "";
  const isFiction = genre === "novel" || genre === "screenplay";
  const parts: string[] = ["【参照ライブラリ：過去作品・参照作品】"];
  for (const w of works) {
    const block: string[] = [`■ ${w.title}（${w.kind === "own" ? "自作" : "参照"}）`];
    if (w.styleProfile) block.push(`文体プロファイル: ${w.styleProfile}`);
    if (w.canonFacts.length) block.push(`確定設定: ${w.canonFacts.slice(0, 12).join(" / ")}`);
    if (w.keyClaims.length) block.push(`既出の主張・トピック: ${w.keyClaims.slice(0, 10).join(" / ")}`);
    if (isFiction && w.characters?.length) {
      block.push(
        "登場人物:\n" +
          w.characters
            .map(
              (c) =>
                `  ・${c.name}（口調: ${c.voice || "不明"}）` +
                (c.keyLines.length ? ` 過去のセリフ: ${c.keyLines.map((l) => `「${l}」`).join("、")}` : ""),
            )
            .join("\n"),
      );
    }
    parts.push(block.join("\n"));
  }
  parts.push(
    "\n【守るべきこと】\n" +
      "- 上記の文体プロファイルを踏襲し、作品全体のトーンを揃える\n" +
      "- 確定設定・登場人物の口調・過去のセリフと矛盾しない\n" +
      "- 既出の主張・エピソードを単に繰り返さない（続編なら前作既知の説明は最小限に、新しい角度を出す）",
  );
  return parts.join("\n\n");
}

// 構成順で「現在のセクションの直前」にあたる生成済みドラフトの本文末尾を返す（翻訳の文体接続用）
function findPreviousDraftTail(project: Project, chapter: Chapter, section: Section): string {
  const outline = project.selectedOutline;
  if (!outline) return "";
  const flat: { chapterId: string; sectionId: string }[] = [];
  for (const c of outline.chapters) {
    for (const s of c.sections ?? []) flat.push({ chapterId: c.id, sectionId: s.id });
  }
  const idx = flat.findIndex((x) => x.chapterId === chapter.id && x.sectionId === section.id);
  for (let i = (idx < 0 ? flat.length : idx) - 1; i >= 0; i--) {
    const d = project.generatedSections.find(
      (g) => g.chapterId === flat[i].chapterId && g.sectionId === flat[i].sectionId,
    );
    if (d?.body?.trim()) return d.body.slice(-600);
  }
  return "";
}

// ニュース: 記事仕様・取材源を system prompt に注入する
function buildNewsContext(project: Project): string {
  const m = project.newsMeta;
  const refs = project.references ?? [];
  const parts: string[] = ["【ニュース記事モード：記事仕様】"];
  parts.push(
    [
      `- 想定媒体: ${m?.outlet || "（未設定）"}`,
      `- 記事種別: ${m ? newsTypeLabel(m.newsType) : "（未設定）"}`,
      `- 切り口・アングル: ${m?.angle || "（未設定）"}`,
      `- 想定読者: ${m?.audience || "（未設定）"}`,
    ].join("\n"),
  );
  if (refs.length > 0) {
    parts.push("## 取材源・出典（登録済み）");
    parts.push(
      refs
        .map(
          (r) =>
            `- ${r.title}${r.author ? ` / ${r.author}` : ""}${r.source ? `（${r.source}）` : ""}${
              r.year ? ` ${r.year}` : ""
            }${r.notes ? ` — ${r.notes}` : ""}`,
        )
        .join("\n"),
    );
  }
  parts.push(
    "\n【守るべきこと】\n" +
      "- 事実の出どころを本文で明示する。上記の取材源にないものは factCheckPoints に「要出典」として挙げる\n" +
      "- 記事種別に応じた構成規律（ストレート=逆ピラミッド、解説=疑問への回答順）を守る\n" +
      "- 事実と論評を分離し、伝聞は断定しない",
  );
  return parts.join("\n\n");
}

// 論文: 論文仕様・参考文献・用語集を system prompt に注入する。
// 注入方針（設計書 §5）: PaperMeta は常時全文（短い固定サイズ）、references / glossary は
// 1行サマリの縮約のみ。原文や長文は入れない
function buildPaperContext(project: Project): string {
  const m = project.paperMeta;
  const refs = project.references ?? [];
  const terms = project.glossary ?? [];
  const parts: string[] = ["【論文モード：論文仕様】"];
  parts.push(
    [
      `- 論文種別: ${m ? paperTypeLabel(m.paperType) : "（未設定）"}`,
      `- 分野: ${m?.field || "（未設定）"}`,
      `- リサーチクエスチョン・仮説: ${m?.researchQuestion || "（未設定）"}`,
      `- 主張したい貢献・新規性: ${m?.contributions || "（未設定）"}`,
      `- 想定投稿先・読者: ${m?.venue || "（未設定）"}`,
      m?.keywords ? `- キーワード: ${m.keywords}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
  const style = m?.citationStyle ?? DEFAULT_CITATION_STYLE;
  if (refs.length > 0) {
    parts.push(
      `## 参考文献（登録済み。体裁=${citationStyleLabel(style)}。引用は各文献末尾の【引用マーカー】をそのまま本文に書くこと）`,
    );
    parts.push(
      refs
        .map(
          (r) =>
            `- ${r.title}${r.author ? ` / ${r.author}` : ""}${r.source ? `（${r.source}）` : ""}${
              r.year ? ` ${r.year}` : ""
            }${r.notes ? ` — ${r.notes}` : ""} 【引用マーカー】${authorYearMarker(r)}`,
        )
        .join("\n"),
    );
  } else {
    parts.push(
      "## 参考文献\n（未登録。引用マーカー〔著者, 年〕は一切使わず、出典が必要な箇所は〔要出典〕とすること）",
    );
  }
  if (terms.length > 0) {
    parts.push("## 用語集（この定義に従って用語を使うこと）");
    parts.push(terms.map((t) => `- ${t.term}: ${t.definition}`).join("\n"));
  }
  parts.push(
    "\n【守るべきこと】\n" +
      citationInstruction(style) +
      "\n- 素材にない結果・数値を書かない。不確かなものは factCheckPoints に挙げる\n" +
      "- 用語は用語集の定義と矛盾しない使い方をすること",
  );
  return parts.join("\n\n");
}

// 翻訳書: 対訳表・文体方針・原文種別の規律を system prompt に注入する
// （論文の翻訳も workType="paper" でこの規律に乗る）
function buildTranslationContext(project: Project): string {
  const meta = project.translationMeta;
  const terms = project.termPairs ?? [];
  const parts: string[] = ["【翻訳書モード：翻訳指示】"];

  parts.push(
    [
      `- 翻訳方向: ${langLabel(meta?.sourceLang)} → ${langLabel(meta?.targetLang)}`,
      `- 原文の種別: ${workTypeLabel(meta?.workType)}`,
      meta?.stylePolicy ? `- 文体方針: ${meta.stylePolicy}` : "- 文体方針: （未設定。標準的な出版翻訳の文体で）",
    ].join("\n"),
  );

  if (terms.length > 0) {
    const sorted = [...terms].sort((a, b) =>
      a.status === b.status ? 0 : a.status === "confirmed" ? -1 : 1,
    );
    parts.push("## 対訳表（この訳語・表記を必ず使う）");
    parts.push(
      sorted
        .slice(0, 80)
        .map(
          (t) =>
            `- ${t.source} → ${t.target}${t.variants?.length ? `（使わない表記: ${t.variants.join("、")}）` : ""}${
              t.notes ? ` — ${t.notes}` : ""
            }`,
        )
        .join("\n"),
    );
  }

  const workType = meta?.workType ?? "book";
  const typeRules =
    workType === "paper"
      ? "- 学術論文として術語を厳密に訳す。定訳のある術語は定訳を使う\n" +
        "- 引用・数式・図表参照（Figure 1, Table 2 等）・文献参照（[12], (Smith, 2020) 等）は原文の形式のまま保持する\n" +
        "- ヘッジ表現（may, suggest, likely）の強さを訳文でも正確に保つ。断定への格上げは禁止\n" +
        "- 「である」調で統一する"
      : workType === "fiction"
        ? "- 登場人物の声（口調・語彙・リズム）を訳文で作る。人物ごとの話し方を一貫させる\n" +
          "- 敬称・呼称（Mr./‑san、あだ名、二人称）の方針を一貫させる\n" +
          "- 直訳で死ぬ比喩・言葉遊びは、効果の等価性を優先して訳す（情報の増減は editorNotes に記録）\n" +
          "- 地の文とセリフの文体を区別する"
        : workType === "article"
          ? "- 記事・ドキュメントとして簡潔で明瞭な訳文にする\n" +
            "- 見出し・箇条書き・強調などの構造を原文どおり保持する\n" +
            "- UI用語・コマンド・コードは翻訳せず原文のまま残す"
          : "- 一般書籍として、正確さを保ちながら日本語（目標言語）として自然に読める訳文にする\n" +
            "- 章・節タイトルの訳語は目次として並んだときの一貫性を意識する";
  parts.push("## 原文種別ごとの規律\n" + typeRules);

  parts.push(
    "\n【守るべきこと】\n" +
      "- 対訳表の訳語・表記を最優先で守る\n" +
      "- 原文の情報を欠落・追加しない\n" +
      "- 直前セグメントの訳文（previousTail）と文体・用語・呼称を揃える",
  );
  return parts.join("\n\n");
}

// ブログ: 対策キーワード・検索意図・ペルソナを system prompt に注入する
function buildBlogContext(project: Project): string {
  const m = project.blogMeta;
  if (!m) return "";
  const parts: string[] = ["【ブログ記事モード：SEO・読者設定】"];
  parts.push(
    [
      `- 対策キーワード: ${m.targetKeyword || "（未設定）"}`,
      m.secondaryKeywords?.length ? `- 関連キーワード: ${m.secondaryKeywords.join("、")}` : "",
      `- 検索意図: ${m.searchIntent || "（未設定）"}`,
      `- 想定読者（ペルソナ）: ${m.persona || "（未設定）"}`,
    ]
      .filter(Boolean)
      .join("\n"),
  );
  parts.push(
    "\n【守るべきこと】\n" +
      "- 検索意図に正面から答える。読者がこの検索で知りたかったことを本文で満たす\n" +
      "- 対策キーワードを見出し直下と本文に自然に含める（詰め込み禁止）\n" +
      "- 想定読者の知識レベル・関心に合わせた具体性で書く",
  );
  return parts.join("\n\n");
}

// 脚本: キャラクター・相関・ロケーション・尺情報・当該シーンの sceneMeta を注入する
function buildScreenplayContext(project: Project, section: Section): string {
  const parts: string[] = ["【脚本モード：作品設定とシーン情報】"];

  const meta = project.screenplayMeta;
  if (meta) {
    parts.push(
      `## 作品仕様\n- メディア種別: ${mediaTypeLabel(meta.mediaType)}\n- 目標尺: ${meta.targetRuntimeMinutes}分`,
    );
  }

  const scene = section.sceneMeta;
  if (scene) {
    parts.push(
      "## このシーンの設定（柱・尺・目的）\n" +
        [
          `- 柱: ○ ${scene.location}（${scene.intExt}・${todJa(scene.timeOfDay)}）`,
          scene.estimatedMinutes != null ? `- 想定尺: ${scene.estimatedMinutes}分` : "",
          scene.presentCharacters?.length
            ? `- 登場人物: ${scene.presentCharacters.join("、")}`
            : "",
          scene.purpose ? `- このシーンの目的: ${scene.purpose}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
    );
  }

  const characters = project.characters ?? [];
  if (characters.length > 0) {
    parts.push("## 登場人物");
    for (const c of characters) {
      parts.push(
        `● ${c.name}（${c.role}）\n` +
          [
            c.profile ? `  profile: ${c.profile}` : "",
            c.desire ? `  desire: ${c.desire}` : "",
            c.voice ? `  voice (口調・語尾): ${c.voice}` : "",
            c.tabooWords?.length ? `  taboo (言わない語): ${c.tabooWords.join("、")}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
      );
    }
  }

  const bible = project.storyBible;
  if (bible?.relationships?.length) {
    const nameOf = (id: string) => characters.find((c) => c.id === id)?.name ?? id;
    parts.push("## 人物相関");
    parts.push(
      bible.relationships
        .map(
          (r) =>
            `- ${nameOf(r.fromId)} ${r.mutual ? "〈相互〉" : "→"} ${nameOf(r.toId)}: ${r.label}`,
        )
        .join("\n"),
    );
  }
  if (bible?.locations?.length) {
    parts.push("## ロケーション（既出。柱の表記を統一すること）");
    parts.push(
      bible.locations
        .map((l) => `- ${l.name}${l.description ? `: ${l.description}` : ""}`)
        .join("\n"),
    );
  }

  parts.push(
    "\n【守るべきこと】\n" +
      "- 柱は sceneMeta の値と一致させる（表記: ○ ロケーション名（INT・夜））\n" +
      "- ト書きは現在形・視覚聴覚情報のみ。心情の直接説明は禁止\n" +
      "- セリフは各キャラの voice / taboo に従う\n" +
      "- 想定尺に見合う分量（1分 ≈ 250〜350字）で、シーンの目的を果たしたら早く出る",
  );

  return parts.join("\n\n");
}

function todJa(tod: string): string {
  switch (tod) {
    case "NIGHT": return "夜";
    case "DAWN": return "明け方";
    case "DUSK": return "夕";
    case "CONTINUOUS": return "続き";
    default: return "昼";
  }
}

// P3: novel の場合に system prompt に足す文字列を組み立てる
function buildNovelContext(project: Project): string {
  const characters = project.characters ?? [];
  const bible = project.storyBible;
  const parts: string[] = ["【小説モード：登場人物と Story Bible】"];

  if (characters.length > 0) {
    parts.push("## 登場人物");
    for (const c of characters) {
      parts.push(
        `● ${c.name}（${c.role}）\n` +
          [
            c.profile ? `  profile: ${c.profile}` : "",
            c.desire ? `  desire (表面的欲望): ${c.desire}` : "",
            c.need ? `  need (真に必要なもの): ${c.need}` : "",
            c.wound ? `  wound: ${c.wound}` : "",
            c.contradiction ? `  contradiction: ${c.contradiction}` : "",
            c.voice ? `  voice (口調・語尾): ${c.voice}` : "",
            c.tabooWords?.length ? `  taboo (言わない語): ${c.tabooWords.join("、")}` : "",
            c.arc
              ? `  arc: start=${c.arc.start}${
                  c.arc.turningPoint ? ` / turn=${c.arc.turningPoint}` : ""
                }${c.arc.end ? ` / end=${c.arc.end}` : ""}`
              : "",
          ]
            .filter(Boolean)
            .join("\n"),
      );
    }
  }

  if (bible) {
    if (bible.worldRules?.length) {
      parts.push("## 世界ルール");
      parts.push(bible.worldRules.map((r) => `- [${r.category}] ${r.rule}`).join("\n"));
    }
    if (bible.timelineEvents?.length) {
      parts.push("## 年表");
      parts.push(
        bible.timelineEvents.map((t) => `- ${t.when}: ${t.event}`).join("\n"),
      );
    }
    if (bible.locations?.length) {
      parts.push("## 場所");
      parts.push(
        bible.locations
          .map((l) => `- ${l.name}${l.description ? `: ${l.description}` : ""}`)
          .join("\n"),
      );
    }
    if (bible.relationships?.length) {
      const nameOf = (id: string) =>
        (project.characters ?? []).find((c) => c.id === id)?.name ?? id;
      parts.push("## 人物相関");
      parts.push(
        bible.relationships
          .map(
            (r) =>
              `- ${nameOf(r.fromId)} ${r.mutual ? "〈相互〉" : "→"} ${nameOf(r.toId)}: ${r.label}${
                r.notes ? `（${r.notes}）` : ""
              }`,
          )
          .join("\n"),
      );
    }
    if (bible.continuityFacts?.length) {
      parts.push("## 継続性ファクト（守るべき細部）");
      parts.push(bible.continuityFacts.map((f) => `- ${f}`).join("\n"));
    }
    if (bible.foreshadowingItems?.length) {
      parts.push("## 伏線");
      parts.push(
        bible.foreshadowingItems
          .filter((f) => f.status !== "resolved")
          .map((f) => `- [${f.status}] ${f.content}`)
          .join("\n"),
      );
    }
  }

  parts.push(
    "\n【守るべきこと】\n" +
      "- 登場人物の voice / tabooWords / desire / need に沿って発話・行動を書くこと\n" +
      "- 世界ルール・年表・継続性ファクトと矛盾しないこと\n" +
      "- 未回収の伏線を潰さないこと (回収は指示された時のみ)",
  );

  return parts.join("\n\n");
}
