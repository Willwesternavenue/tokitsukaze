"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  addSectionToChapter,
  clearPendingRun,
  effectiveTermPairs,
  listPendingRuns,
  loadProject,
  loadPrompts,
  removeSectionFromOutline,
  replaceSelectedOutline,
  saveManualBodyEdit,
  saveSectionAgentReports,
  setPendingRun,
  setSectionLocked,
  updateSectionInOutline,
  upsertDraft,
  withStyleRules,
} from "@/lib/storage";
import type {
  AgentReportSummary,
  Chapter,
  ImpactItem,
  OutlineProposal,
  Project,
  Section,
  SectionDraft,
} from "@/lib/types";
import { exportBilingualDocx, exportProjectDocx, exportSectionDocx } from "@/lib/docx";
import { postJson, startAndPollRun } from "@/lib/apiClient";
import type { SectionsWorkflowResult } from "@/workflows/sections";
import { buildScreenplayExtraContext, getGenreConfig } from "@/lib/genreConfig";
import { diffLines, diffStats } from "@/lib/diff";
import {
  finishSectionDraft,
  generateSectionDraft,
  listUntranslated,
  startSectionDraft,
} from "@/lib/translationClient";
import { buildFountain, measureRuntime } from "@/lib/screenplay";
import { saveAs } from "file-saver";

type Selected = { chapter: Chapter; section: Section } | null;

type TranslationView = "bilingual" | "target" | "diff";

type BatchState = {
  running: boolean;
  done: number;
  total: number;
  current: string;
  failures: string[];
};

const TOD_JA: Record<string, string> = {
  DAY: "昼",
  NIGHT: "夜",
  DAWN: "明け方",
  DUSK: "夕",
  CONTINUOUS: "続き",
};

export default function WriterPage() {
  const [project, setProject] = useState<Project | null>(null);
  const [selected, setSelected] = useState<Selected>(null);
  const [loading, setLoading] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [regenSections, setRegenSections] = useState(false);
  const [editingHeading, setEditingHeading] = useState(false);
  const [headingInstruction, setHeadingInstruction] = useState("");
  const [refiningHeading, setRefiningHeading] = useState(false);
  // 波及反映（A+B）
  const [detectingImpact, setDetectingImpact] = useState(false);
  const [impactItems, setImpactItems] = useState<ImpactItem[] | null>(null);
  const [impactSource, setImpactSource] = useState<{ chapterId: string; sectionId: string } | null>(null);
  const [propagating, setPropagating] = useState(false);
  const [propagateProgress, setPropagateProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 翻訳書モード: 表示タブ / 訳文編集 / Diff比較元
  const [trView, setTrView] = useState<TranslationView>("bilingual");
  const [editingBody, setEditingBody] = useState(false);
  const [bodyDraft, setBodyDraft] = useState("");
  const [showBodyDiff, setShowBodyDiff] = useState(false);
  const [diffBaseIdx, setDiffBaseIdx] = useState<number | null>(null); // null = 最新の旧版
  // 翻訳書モード: 一括翻訳
  const [batch, setBatch] = useState<BatchState | null>(null);
  const batchCancelRef = useRef(false);
  // 生成の復帰（タブ切替・移動・リロード対策）: 進行中/復帰中の runId を追跡
  const activePollsRef = useRef<Set<string>>(new Set());
  const [resumingKeys, setResumingKeys] = useState<string[]>([]);

  useEffect(() => {
    const p = loadProject();
    setProject(p);
    if (p.selectedOutline?.chapters.length) {
      const firstChapter = p.selectedOutline.chapters[0];
      const firstSection = firstChapter.sections?.[0];
      if (firstSection) setSelected({ chapter: firstChapter, section: firstSection });
    }
    // 進行中の生成があれば復帰（前回タブを閉じた/移動した/リロードした場合）
    resumePendingRuns(p.id);
    // 復帰後にタブに戻ってきたら即再ポーリング（背景タブの間引き対策）
    const onVis = () => {
      if (document.visibilityState === "visible") {
        const cur = loadProject();
        resumePendingRuns(cur.id);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 進行中 run を完了までポーリングして結果を適用する（多重ポーリングは runId で抑止）
  function pollAndApply(runId: string, chapterId: string, sectionId: string, projectId: string) {
    if (activePollsRef.current.has(runId)) return;
    activePollsRef.current.add(runId);
    const key = `${chapterId}::${sectionId}`;
    setResumingKeys((prev) => (prev.includes(key) ? prev : [...prev, key]));
    finishSectionDraft(runId)
      .then((next) => {
        clearPendingRun(projectId, chapterId, sectionId);
        setProject(next);
      })
      .catch((e) => {
        // 失敗（サーバ側failed等）は pending を消す。一時的な取得失敗は次回訪問で再試行される
        clearPendingRun(projectId, chapterId, sectionId);
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        activePollsRef.current.delete(runId);
        setResumingKeys((prev) => prev.filter((k) => k !== key));
      });
  }

  function resumePendingRuns(projectId: string) {
    for (const pr of listPendingRuns(projectId)) {
      pollAndApply(pr.runId, pr.chapterId, pr.sectionId, projectId);
    }
  }

  // 選択セグメントが変わったら翻訳モードの編集・Diff状態をリセット
  useEffect(() => {
    setEditingBody(false);
    setDiffBaseIdx(null);
  }, [selected?.chapter.id, selected?.section.id]);

  const genreCfg = getGenreConfig(project?.genre);
  const writingTitle = genreCfg.stages.writing.pageTitle;
  const isScreenplay = project?.genre === "screenplay";
  const isTranslation = project?.genre === "translation";
  const targetMinutes = project?.screenplayMeta?.targetRuntimeMinutes ?? 0;
  const totalMinutes = useMemo(() => {
    if (!isScreenplay || !project?.selectedOutline) return 0;
    return Math.round(
      project.selectedOutline.chapters.reduce(
        (sum, c) =>
          sum + (c.sections ?? []).reduce((s2, s) => s2 + (s.sceneMeta?.estimatedMinutes ?? 0), 0),
        0,
      ),
    );
  }, [isScreenplay, project]);

  // 脚本: 執筆済み本文からの実測尺（セリフ≈320字/分・ト書き≈450字/分の機械換算）
  const measuredMinutes = useMemo(() => {
    if (!isScreenplay || !project) return 0;
    const total = project.generatedSections.reduce(
      (sum, d) => sum + (d.body ? measureRuntime(d.body).estimatedMinutes : 0),
      0,
    );
    return Math.round(total * 10) / 10;
  }, [isScreenplay, project]);

  const draftMap = useMemo(() => {
    const m = new Map<string, SectionDraft>();
    project?.generatedSections.forEach((d) => m.set(`${d.chapterId}::${d.sectionId}`, d));
    return m;
  }, [project]);

  // 翻訳書: 章別・全体の翻訳進捗（左ペインのゲージと一括翻訳ボタンの元データ）
  const trProgress = useMemo(() => {
    if (!isTranslation || !project?.selectedOutline) return null;
    let total = 0;
    let translated = 0;
    const perChapter = new Map<string, { done: number; total: number }>();
    for (const c of project.selectedOutline.chapters) {
      const t = (c.sections ?? []).length;
      const d = (c.sections ?? []).filter((s) => {
        const dr = draftMap.get(`${c.id}::${s.id}`);
        return !!dr?.body?.trim();
      }).length;
      total += t;
      translated += d;
      perChapter.set(c.id, { done: d, total: t });
    }
    return { total, translated, perChapter };
  }, [isTranslation, project, draftMap]);

  // 実効対訳表（参照グローバルセット含む）の確定語数。ワークフロー案内の表示判定に使う
  const confirmedTermCount = useMemo(
    () => (project ? effectiveTermPairs(project).filter((t) => t.status === "confirmed").length : 0),
    [project],
  );

  const currentDraft: SectionDraft | undefined = useMemo(() => {
    if (!selected) return undefined;
    return draftMap.get(`${selected.chapter.id}::${selected.section.id}`);
  }, [selected, draftMap]);

  const currentAgentReports: AgentReportSummary[] = useMemo(() => {
    if (!selected || !project) return [];
    return (
      project.sectionAgentReports?.[`${selected.chapter.id}::${selected.section.id}`] ?? []
    );
  }, [selected, project]);

  if (!project) {
    return (
      <>
        <div className="page-header">
          <div>
            <h1>{writingTitle}</h1>
            <p className="subtitle">選択した構成案をもとに、小見出し単位で本文を生成します。</p>
          </div>
        </div>
        <div className="empty-state">読み込み中…</div>
      </>
    );
  }

  if (!project.selectedOutline) {
    return (
      <>
        <div className="page-header">
          <div>
            <h1>{writingTitle}</h1>
            <p className="subtitle">構成案がまだ選ばれていません。</p>
          </div>
        </div>
        <div className="empty-state">
          先に構成案画面で1案を選択してください。
          <div style={{ marginTop: 12 }}>
            <Link className="btn primary" href="/outline">構成案画面へ</Link>
          </div>
        </div>
      </>
    );
  }

  async function handleGenerate(force = false) {
    if (!project || !selected) return;
    // 手動編集して保護中の節（非翻訳）を再生成すると編集が失われるため確認する
    if (
      force &&
      !isTranslation &&
      currentDraft?.bodyEditedAt &&
      currentDraft.locked &&
      !confirm("この節は手動編集され保護中です。再生成すると手動編集が失われます（旧版は変更差分から復元できます）。再生成しますか？")
    ) {
      return;
    }
    setError(null);
    setLoading(true);
    const { chapter, section } = selected;
    try {
      // 開始→runId保存（タブを閉じても復帰で回収できる）→完了までポーリング→適用
      const runId = await startSectionDraft(project, chapter, section);
      setPendingRun({
        projectId: project.id,
        chapterId: chapter.id,
        sectionId: section.id,
        chapterTitle: chapter.title,
        sectionTitle: section.title,
        runId,
        startedAt: new Date().toISOString(),
      });
      activePollsRef.current.add(runId);
      try {
        const next = await finishSectionDraft(runId);
        setProject(next);
      } finally {
        activePollsRef.current.delete(runId);
      }
      clearPendingRun(project.id, chapter.id, section.id);
    } catch (e) {
      // ここに来るのは開始失敗 or サーバfailed。pending は残さない（残すと復帰で再失敗ループ）
      clearPendingRun(project.id, chapter.id, section.id);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  // 指定の章・節を、渡された最新 project を context にして再生成し upsert する（波及・一括用）
  async function regenerateOne(
    baseProject: Project,
    chapter: Chapter,
    section: Section,
  ): Promise<Project> {
    return generateSectionDraft(baseProject, chapter, section);
  }

  // 翻訳書: 未翻訳セグメントを構成順に一括翻訳する（失敗はスキップして継続、中断可能）
  async function handleBatchTranslate(chapterId?: string) {
    if (!project || batch?.running) return;
    const targets = listUntranslated(project, chapterId);
    if (targets.length === 0) {
      setError(chapterId ? "この章に未翻訳のセグメントはありません。" : "未翻訳のセグメントはありません。");
      return;
    }
    if (
      !confirm(
        `${targets.length} セグメントを順番に翻訳します（1セグメントあたり数十秒）。途中で中断できます。開始しますか？`,
      )
    ) {
      return;
    }
    setError(null);
    batchCancelRef.current = false;
    const failures: string[] = [];
    let cur = project;
    let done = 0;
    setBatch({ running: true, done, total: targets.length, current: "", failures });
    for (const t of targets) {
      if (batchCancelRef.current) break;
      setBatch({
        running: true,
        done,
        total: targets.length,
        current: `${t.chapter.title} / ${t.section.title}`,
        failures: [...failures],
      });
      try {
        cur = await regenerateOne(cur, t.chapter, t.section);
        setProject(cur);
      } catch (e) {
        failures.push(
          `${t.chapter.title} / ${t.section.title}：${e instanceof Error ? e.message : String(e)}`,
        );
      }
      done++;
    }
    setBatch({
      running: false,
      done,
      total: targets.length,
      current: batchCancelRef.current ? "（中断しました）" : "",
      failures: [...failures],
    });
  }

  // B: この節の編集が下流に与える影響を検出する
  async function handleDetectImpact() {
    if (!project || !selected) return;
    setError(null);
    setImpactItems(null);
    setDetectingImpact(true);
    try {
      const r = await postJson<{ items?: ImpactItem[] }>("/api/detect-impact", {
        project,
        changedChapterId: selected.chapter.id,
        changedSectionId: selected.section.id,
      });
      if (!r.ok) throw new Error(r.error ?? "影響の検出に失敗しました。");
      setImpactItems(r.data?.items ?? []);
      setImpactSource({ chapterId: selected.chapter.id, sectionId: selected.section.id });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDetectingImpact(false);
    }
  }

  // A: 影響ありの節を、構成順に再生成する（locked は保護）
  async function handlePropagate() {
    if (!project || !impactItems) return;
    setError(null);
    setPropagating(true);
    try {
      const outline = project.selectedOutline;
      if (!outline) throw new Error("構成案がありません。");
      // 構成順に並べる
      const orderIndex = new Map<string, number>();
      let oi = 0;
      for (const c of outline.chapters) for (const s of c.sections) orderIndex.set(`${c.id}::${s.id}`, oi++);
      const targets = [...impactItems]
        .filter((it) => {
          const d = project.generatedSections.find(
            (g) => g.chapterId === it.chapterId && g.sectionId === it.sectionId,
          );
          return d && !d.locked; // locked は再生成しない
        })
        .sort(
          (a, b) =>
            (orderIndex.get(`${a.chapterId}::${a.sectionId}`) ?? 0) -
            (orderIndex.get(`${b.chapterId}::${b.sectionId}`) ?? 0),
        );

      let cur = project;
      for (let i = 0; i < targets.length; i++) {
        const it = targets[i];
        const chapter = outline.chapters.find((c) => c.id === it.chapterId);
        const section = chapter?.sections.find((s) => s.id === it.sectionId);
        if (!chapter || !section) continue;
        setPropagateProgress(`${i + 1}/${targets.length}：${section.title} を再生成中…`);
        // 直前までの再生成結果を織り込むため、毎回最新 project を渡す
        cur = await regenerateOne(cur, chapter, section);
        setProject(cur);
      }
      setPropagateProgress(null);
      setImpactItems(null);
      setImpactSource(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPropagateProgress(null);
    } finally {
      setPropagating(false);
    }
  }

  function handleToggleLock(chapterId: string, sectionId: string, locked: boolean) {
    const next = setSectionLocked(chapterId, sectionId, locked);
    setProject(next);
  }

  async function handleReview() {
    if (!project || !currentDraft) return;
    setError(null);
    setReviewing(true);
    try {
      const prompts = loadPrompts();
      const base = prompts.find((p) => p.id === "prompt-review");
      const promptTemplate = base ? withStyleRules(base, project.genre) : undefined;
      const r = await postJson<{
        editorNotes?: string[];
        followUpQuestions?: string[];
        factCheckPoints?: string[];
        revisionSuggestions?: string[];
      }>("/api/review-draft", {
        draft: currentDraft,
        writingMemory: project.writingMemory,
        promptTemplate,
      });
      if (!r.ok) throw new Error(r.error ?? "編集レビューに失敗しました。");
      const data = r.data ?? {};
      const merged: SectionDraft = {
        ...currentDraft,
        editorNotes: [...currentDraft.editorNotes, ...(data.editorNotes ?? [])],
        followUpQuestions: [...currentDraft.followUpQuestions, ...(data.followUpQuestions ?? [])],
        factCheckPoints: [...currentDraft.factCheckPoints, ...(data.factCheckPoints ?? [])],
        continuityNotes: [
          ...currentDraft.continuityNotes,
          ...((data.revisionSuggestions ?? []) as string[]).map((s) => `[修正案] ${s}`),
        ],
        updatedAt: new Date().toISOString(),
      };
      const next = upsertDraft(merged);
      setProject(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setReviewing(false);
    }
  }

  // 小見出しの個別編集後、selected を最新の section 参照に同期する
  function syncSelectedFrom(p: Project, chapterId: string, sectionId: string | null) {
    const ch = p.selectedOutline?.chapters.find((c) => c.id === chapterId);
    if (!ch) return;
    const sec = sectionId ? ch.sections.find((s) => s.id === sectionId) : ch.sections[0];
    if (sec) setSelected({ chapter: ch, section: sec });
    else setSelected(null);
  }

  // 手動編集: 小見出しの title / summary
  function handleEditHeading(patch: { title?: string; summary?: string }) {
    if (!selected) return;
    const next = updateSectionInOutline(selected.chapter.id, selected.section.id, patch);
    setProject(next);
    syncSelectedFrom(next, selected.chapter.id, selected.section.id);
  }

  // 論文モード: この節に使う文献の紐付けをトグルする
  function handleToggleSectionReference(refId: string, checked: boolean) {
    if (!selected) return;
    const current = selected.section.referenceIds ?? [];
    const nextIds = checked
      ? Array.from(new Set([...current, refId]))
      : current.filter((id) => id !== refId);
    const next = updateSectionInOutline(selected.chapter.id, selected.section.id, {
      referenceIds: nextIds,
    });
    setProject(next);
    syncSelectedFrom(next, selected.chapter.id, selected.section.id);
  }

  // 手動: 章に小見出しを追加
  function handleAddSection(chapterId: string) {
    const next = addSectionToChapter(chapterId);
    setProject(next);
    const ch = next.selectedOutline?.chapters.find((c) => c.id === chapterId);
    const added = ch?.sections[ch.sections.length - 1];
    if (ch && added) setSelected({ chapter: ch, section: added });
  }

  // 手動: 小見出しを削除
  function handleDeleteSection() {
    if (!selected) return;
    if (!confirm("この小見出しを削除します。生成済みの本文も含めて表示されなくなります。よろしいですか？")) return;
    const chapterId = selected.chapter.id;
    const next = removeSectionFromOutline(chapterId, selected.section.id);
    setProject(next);
    setEditingHeading(false);
    syncSelectedFrom(next, chapterId, null);
  }

  // AI: この小見出しだけを修正
  async function handleRefineHeading() {
    if (!selected || !project) return;
    const instruction = headingInstruction.trim();
    if (!instruction) {
      setError("小見出しの修正指示を入力してください。");
      return;
    }
    setError(null);
    setRefiningHeading(true);
    try {
      const r = await postJson<{ outline?: OutlineProposal }>("/api/refine-outline", {
        outline: project.selectedOutline,
        instruction,
        scope: "section",
        chapterId: selected.chapter.id,
        sectionId: selected.section.id,
        genreLabel: genreCfg.label,
        unit: "小見出し",
      });
      if (!r.ok) throw new Error(r.error ?? "小見出しの修正に失敗しました。");
      if (r.data?.outline) {
        const next = replaceSelectedOutline(r.data.outline);
        setProject(next);
        syncSelectedFrom(next, selected.chapter.id, selected.section.id);
        setHeadingInstruction("");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefiningHeading(false);
    }
  }

  async function handleRegenSections() {
    if (!project?.selectedOutline) return;
    setError(null);
    setRegenSections(true);
    try {
      // 既存の小見出しをクリアしてから再生成（無いとAPIは「もうあるよ」と判断する場合がある）
      const cleared = {
        ...project.selectedOutline,
        chapters: project.selectedOutline.chapters.map((c) => ({ ...c, sections: [] })),
      };
      const r = await startAndPollRun<SectionsWorkflowResult>("/api/generate-sections", {
        selectedOutline: cleared,
        interviewNotes: project.interviewNotes,
        writingMemory: project.writingMemory,
        genre: project.genre,
        extraContext: buildScreenplayExtraContext(project),
      });
      if (!r.ok) throw new Error(r.error);
      if (!r.result.ok) {
        throw new Error("AI出力の解釈に失敗しました。もう一度お試しください。");
      }
      const outline = r.result.outline;
      const totalSections = (outline.chapters ?? []).reduce(
        (sum: number, c: Chapter) => sum + (c.sections?.length ?? 0),
        0,
      );
      if (totalSections === 0) {
        throw new Error("小見出しが1件も生成されませんでした。もう一度お試しください。");
      }
      const next = replaceSelectedOutline(outline);
      setProject(next);
      // 最初の小見出しを選択状態に
      const firstChapter = outline.chapters?.[0];
      const firstSection = firstChapter?.sections?.[0];
      if (firstChapter && firstSection) {
        setSelected({ chapter: firstChapter, section: firstSection });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRegenSections(false);
    }
  }

  async function handleExportSection(includeNotes = false) {
    if (!project || !currentDraft) return;
    setExporting(true);
    try {
      await exportSectionDocx(project, currentDraft, includeNotes);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  }

  async function handleExportAll(includeNotes = false) {
    if (!project) return;
    if (project.generatedSections.length === 0) {
      setError("Word出力対象の本文がありません。先に本文を生成してください。");
      return;
    }
    setExporting(true);
    try {
      await exportProjectDocx(project, includeNotes);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  }

  // ===== 翻訳書モード: 訳文編集・対訳Word出力 =====

  function handleStartEditBody() {
    if (!currentDraft) return;
    setBodyDraft(currentDraft.body);
    setEditingBody(true);
    setTrView("target");
  }

  function handleSelectSection(chapter: Chapter, section: Section) {
    if (
      editingBody &&
      currentDraft &&
      bodyDraft !== currentDraft.body &&
      !confirm("未保存の編集があります。破棄して移動しますか？")
    ) {
      return;
    }
    setEditingBody(false);
    setShowBodyDiff(false);
    setSelected({ chapter, section });
  }

  function handleSaveBody() {
    if (!selected || !currentDraft) return;
    // isManualEdit=!isTranslation。翻訳は自動ロックも履歴圧縮もしない＝従来どおり毎回1版積む
    // （波及・一括翻訳の対象から外さない／訳文の「変更差分」から中間版が消えない）。
    const next = saveManualBodyEdit(
      selected.chapter.id,
      selected.section.id,
      bodyDraft,
      !isTranslation,
    );
    setProject(next);
    setEditingBody(false);
  }

  async function handleExportBilingual() {
    if (!project) return;
    setExporting(true);
    try {
      await exportBilingualDocx(project);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  }

  const outline = project.selectedOutline;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>{writingTitle}</h1>
          <p className="subtitle">
            構成：<strong>{outline.title}</strong>　／
            生成済み {project.generatedSections.length} / {outline.chapters.reduce((a, c) => a + c.sections.length, 0)} 節
          </p>
        </div>
        <div className="actions">
          {isTranslation && trProgress && trProgress.translated < trProgress.total ? (
            batch?.running ? (
              <button
                className="btn danger"
                onClick={() => { batchCancelRef.current = true; }}
                type="button"
              >
                一括翻訳を中断
              </button>
            ) : (
              <button
                className="btn primary"
                onClick={() => handleBatchTranslate()}
                disabled={loading}
                type="button"
              >
                未翻訳をすべて翻訳（残り {trProgress.total - trProgress.translated}）
              </button>
            )
          ) : null}
          {isTranslation ? (
            <button className="btn" onClick={handleExportBilingual} disabled={exporting} type="button">
              {exporting ? <span className="spinner" /> : null}
              対訳Wordを出力
            </button>
          ) : null}
          {isScreenplay ? (
            <button
              className="btn"
              type="button"
              title="Fountain形式（Final Draft / Highland 等の業界ツールで読み込み可能）"
              onClick={() => {
                if (!project) return;
                const blob = new Blob([buildFountain(project)], { type: "text/plain;charset=utf-8" });
                saveAs(blob, `${project.name}.fountain`);
              }}
            >
              Fountainで出力
            </button>
          ) : null}
          <button className="btn" onClick={() => handleExportAll(false)} disabled={exporting} type="button">
            {exporting ? <span className="spinner" /> : null}
            {isTranslation ? "訳文Wordを出力" : "全体Wordを出力"}
          </button>
          <button
            className="btn"
            onClick={() => handleExportAll(true)}
            disabled={exporting}
            type="button"
            title="本文に加えて編集メモ・追加質問・事実確認・つながりメモも書き出す（校正用）"
          >
            メモ付きWord
          </button>
        </div>
      </div>

      {error ? <div className="alert" style={{ marginBottom: 16 }}>{error}</div> : null}

      {resumingKeys.length > 0 ? (
        <div className="alert info" style={{ marginBottom: 16 }}>
          <span className="spinner" /> 中断された生成を復帰しています（{resumingKeys.length} 件）。
          このまま完了を待つと結果が反映されます。
        </div>
      ) : null}

      {batch ? (
        <div className="alert info" style={{ marginBottom: 16 }}>
          {batch.running ? (
            <>
              <span className="spinner" /> 一括翻訳中 {batch.done + 1}/{batch.total}：{batch.current}
              {batch.failures.length > 0 ? `（失敗 ${batch.failures.length} 件はスキップ）` : ""}
            </>
          ) : (
            <div className="flex" style={{ alignItems: "flex-start", gap: 10 }}>
              <span style={{ flex: 1 }}>
                一括翻訳が終了しました（{batch.done}/{batch.total} 処理
                {batch.current ? ` ${batch.current}` : ""}
                {batch.failures.length > 0 ? `、失敗 ${batch.failures.length} 件` : "、失敗なし"}）。
                {batch.failures.length > 0 ? (
                  <span style={{ display: "block", fontSize: 11, marginTop: 4 }}>
                    {batch.failures.map((f, i) => (
                      <span key={i} style={{ display: "block" }}>・{f}</span>
                    ))}
                    失敗分は「未翻訳をすべて翻訳」でもう一度実行すると再開できます。
                  </span>
                ) : null}
              </span>
              <button className="btn sm" type="button" onClick={() => setBatch(null)}>閉じる</button>
            </div>
          )}
        </div>
      ) : null}

      {isTranslation && trProgress && trProgress.total > 3 && confirmedTermCount === 0 && trProgress.translated < 4 ? (
        <div className="alert info" style={{ marginBottom: 16 }}>
          おすすめの進め方：最初の2〜3セグメントを翻訳 →{" "}
          <Link href="/terms">対訳表・用語</Link> で「AIで用語を抽出」→ 訳語を確定 →
          「未翻訳をすべて翻訳」で残りを一括翻訳。用語・固有名詞が最初から統一されます。
        </div>
      ) : null}

      <div className="writer-shell">
        <aside className="panel">
          <div className="panel-header">
            <h2>{isTranslation ? "章・セグメント" : "章・小見出し"}</h2>
            {!isTranslation ? (
              <button
                className="btn sm"
                onClick={handleRegenSections}
                disabled={regenSections}
                type="button"
                title="AIに小見出しを再生成させる"
              >
                {regenSections ? <span className="spinner" /> : null}
                {regenSections ? "再生成中…" : "小見出しを再生成"}
              </button>
            ) : null}
          </div>
          <div className="panel-body dense">
            {isTranslation && trProgress ? (
              <div className="runtime-gauge">
                <div className="runtime-gauge-head">
                  <strong>翻訳進捗</strong>
                  <span>
                    {trProgress.translated} / {trProgress.total} セグメント
                    {trProgress.total > 0
                      ? `（${Math.round((trProgress.translated / trProgress.total) * 100)}%）`
                      : ""}
                  </span>
                </div>
                {trProgress.total > 0 ? (
                  <div className="runtime-bar">
                    <div
                      className="runtime-bar-fill"
                      style={{ width: `${(trProgress.translated / trProgress.total) * 100}%` }}
                    />
                  </div>
                ) : null}
              </div>
            ) : null}
            {isScreenplay ? (
              <div className="runtime-gauge">
                <div className="runtime-gauge-head">
                  <strong>想定尺</strong>
                  <span className={totalMinutes > targetMinutes ? "runtime-over" : ""}>
                    {totalMinutes > 0 ? `${totalMinutes}分` : "未設定"}
                    {targetMinutes > 0 ? ` / 目標 ${targetMinutes}分` : ""}
                    {measuredMinutes > 0 ? `（実測 ${measuredMinutes}分）` : ""}
                  </span>
                </div>
                {targetMinutes > 0 && totalMinutes > 0 ? (
                  <div className="runtime-bar">
                    <div
                      className={`runtime-bar-fill ${totalMinutes > targetMinutes ? "over" : ""}`}
                      style={{ width: `${Math.min(100, (totalMinutes / targetMinutes) * 100)}%` }}
                    />
                  </div>
                ) : null}
              </div>
            ) : null}
            <ul className="toc">
              {outline.chapters.map((c) => {
                const chapterMinutes = (c.sections ?? []).reduce(
                  (sum, s) => sum + (s.sceneMeta?.estimatedMinutes ?? 0),
                  0,
                );
                return (
                <li key={c.id} className="chapter">
                  <div className="chapter-title">
                    <span style={{ flex: 1 }}>第{c.chapterNumber}章　{c.title}</span>
                    {isScreenplay && chapterMinutes > 0 ? (
                      <span className="chapter-minutes">{Math.round(chapterMinutes)}分</span>
                    ) : null}
                    {isTranslation ? (
                      (() => {
                        const pc = trProgress?.perChapter.get(c.id);
                        if (!pc) return null;
                        return (
                          <>
                            <span className="chapter-minutes">{pc.done}/{pc.total}</span>
                            {pc.done < pc.total ? (
                              <button
                                className="chapter-add-btn"
                                type="button"
                                title="この章の未翻訳セグメントをすべて翻訳"
                                disabled={batch?.running || loading}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleBatchTranslate(c.id);
                                }}
                              >
                                ▶
                              </button>
                            ) : null}
                          </>
                        );
                      })()
                    ) : (
                      <button
                        className="chapter-add-btn"
                        type="button"
                        title="この章に小見出しを追加"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAddSection(c.id);
                        }}
                      >
                        ＋
                      </button>
                    )}
                  </div>
                  <ul className="section-list">
                    {(c.sections ?? []).length === 0 ? (
                      <li className="muted" style={{ padding: 8, fontSize: 12 }}>
                        小見出しがまだ生成されていません。
                      </li>
                    ) : null}
                    {(c.sections ?? []).map((s) => {
                      const k = `${c.id}::${s.id}`;
                      const hasDraft = draftMap.has(k);
                      const isActive = selected?.chapter.id === c.id && selected?.section.id === s.id;
                      return (
                        <li
                          key={s.id}
                          className={`section ${isActive ? "active" : ""} ${hasDraft ? "has-draft" : ""}`}
                          onClick={() => handleSelectSection(c, s)}
                        >
                          <span className="dot" />
                          <span style={{ flex: 1 }}>
                            {s.title}
                            {isScreenplay && s.sceneMeta ? (
                              <span className="scene-slug">
                                ○ {s.sceneMeta.location}（{s.sceneMeta.intExt}・
                                {TOD_JA[s.sceneMeta.timeOfDay] ?? "昼"}）
                              </span>
                            ) : null}
                          </span>
                          {isScreenplay && s.sceneMeta?.estimatedMinutes != null ? (
                            <span className="scene-minutes">{s.sceneMeta.estimatedMinutes}分</span>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </li>
                );
              })}
            </ul>
          </div>
        </aside>

        <section>
          {!selected ? (
            <div className="empty-state">左の一覧から小見出しを選んでください。</div>
          ) : (
            <>
              <div className="panel">
                <div className="panel-header">
                  <div>
                    <div className="muted" style={{ fontSize: 11 }}>
                      第{selected.chapter.chapterNumber}章　{selected.chapter.title}
                    </div>
                    <h2 style={{ fontSize: 15, marginTop: 2 }}>{selected.section.title}</h2>
                    {!isTranslation && currentDraft?.bodyEditedAt ? (
                      <span className="badge warn" style={{ fontSize: 10, marginTop: 4, display: "inline-block" }}>
                        手動編集済み{currentDraft.locked ? "（保護中）" : ""}
                      </span>
                    ) : null}
                  </div>
                  <div className="row-actions">
                    <button
                      className={`btn ${editingHeading ? "primary" : ""}`}
                      onClick={() => setEditingHeading((v) => !v)}
                      type="button"
                    >
                      {editingHeading ? "編集を閉じる" : "小見出しを編集"}
                    </button>
                    {currentDraft ? (
                      <button
                        className="btn"
                        onClick={() => handleGenerate(true)}
                        disabled={loading || batch?.running}
                        type="button"
                      >
                        {loading ? <span className="spinner" /> : null}
                        {isTranslation ? "再翻訳" : "本文を再生成"}
                      </button>
                    ) : (
                      <button
                        className="btn primary"
                        onClick={() => handleGenerate(false)}
                        disabled={loading || batch?.running}
                        type="button"
                      >
                        {loading ? <span className="spinner" /> : null}
                        {loading
                          ? isTranslation ? "翻訳中…" : "生成中…"
                          : isTranslation ? "このセグメントを翻訳" : "この小見出しの本文を生成"}
                      </button>
                    )}
                    {currentDraft && !editingBody ? (
                      <button className="btn" onClick={handleStartEditBody} type="button">
                        {isTranslation ? "訳文を編集" : "本文を編集"}
                      </button>
                    ) : null}
                    <button
                      className="btn"
                      onClick={handleReview}
                      disabled={!currentDraft || reviewing}
                      type="button"
                    >
                      {reviewing ? <span className="spinner" /> : null}
                      編集レビューを追加
                    </button>
                    <button
                      className="btn"
                      onClick={() => handleExportSection(false)}
                      disabled={!currentDraft || exporting}
                      type="button"
                    >
                      Wordで保存
                    </button>
                  </div>
                </div>
                {editingHeading ? (
                  <div className="panel-body" style={{ borderBottom: "1px solid var(--border)", background: "var(--panel-alt)" }}>
                    <div className="field" style={{ marginBottom: 8 }}>
                      <label>小見出しタイトル</label>
                      <input
                        className="input"
                        type="text"
                        value={selected.section.title}
                        onChange={(e) => handleEditHeading({ title: e.target.value })}
                      />
                    </div>
                    <div className="field" style={{ marginBottom: 8 }}>
                      <label>この小見出しで扱う内容（概要）</label>
                      <textarea
                        className="input"
                        rows={2}
                        value={selected.section.summary ?? ""}
                        onChange={(e) => handleEditHeading({ summary: e.target.value })}
                        placeholder="本文生成の指針になります"
                      />
                    </div>
                    <div className="flex" style={{ alignItems: "flex-start" }}>
                      {!isTranslation ? (
                        <>
                          <input
                            className="input"
                            type="text"
                            value={headingInstruction}
                            onChange={(e) => setHeadingInstruction(e.target.value)}
                            placeholder="AIで小見出しを調整する指示（例：もっと具体的に / 読者の疑問形に）"
                            style={{ flex: 1 }}
                          />
                          <button
                            className="btn"
                            type="button"
                            onClick={handleRefineHeading}
                            disabled={refiningHeading}
                            style={{ whiteSpace: "nowrap" }}
                          >
                            {refiningHeading ? <span className="spinner" /> : null}
                            AIで修正
                          </button>
                        </>
                      ) : (
                        <span className="hint" style={{ flex: 1 }}>
                          セグメントのタイトル・概要は手動で編集できます（原文は変更されません）。
                        </span>
                      )}
                      <button
                        className="btn danger"
                        type="button"
                        onClick={handleDeleteSection}
                        style={{ whiteSpace: "nowrap" }}
                      >
                        削除
                      </button>
                    </div>
                    <p className="help" style={{ marginTop: 8 }}>
                      小見出しを直したら「本文を{currentDraft ? "再" : ""}生成」で、新しい小見出しに沿った本文を作れます。
                    </p>
                    {project.genre === "paper" && (project.references?.length ?? 0) > 0 ? (
                      <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed var(--border)" }}>
                        <div className="field-label">この節で使う文献（優先的に引用されます）</div>
                        <ul className="list-block" style={{ border: "1px solid var(--border)", borderRadius: 3 }}>
                          {project.references.map((r) => {
                            const checked = (selected.section.referenceIds ?? []).includes(r.id);
                            return (
                              <li key={r.id}>
                                <label className="staff-toggle" style={{ gap: 8 }}>
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={(e) => handleToggleSectionReference(r.id, e.target.checked)}
                                  />
                                  <span style={{ fontSize: 12 }}>
                                    {r.title}
                                    {r.author ? <span className="muted">（{r.author}{r.year ? ` ${r.year}` : ""}）</span> : null}
                                  </span>
                                </label>
                              </li>
                            );
                          })}
                        </ul>
                        <p className="help" style={{ marginTop: 6 }}>
                          チェックした文献は、この節の本文生成時に「優先的に引用する文献」としてAIへ渡されます。
                          文献の登録・編集は <Link href="/references">参考文献・文献カルテ</Link> で。
                        </p>
                      </div>
                    ) : null}
                    {currentDraft ? (
                      <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed var(--border)" }}>
                        <div className="flex between" style={{ alignItems: "center" }}>
                          <span style={{ fontSize: 12, color: "var(--text-soft)" }}>
                            この節を直した影響で、以降の本文に矛盾が出ていないか確認します。
                          </span>
                          <button
                            className="btn"
                            type="button"
                            onClick={handleDetectImpact}
                            disabled={detectingImpact || propagating}
                          >
                            {detectingImpact ? <span className="spinner" /> : null}
                            編集の影響を確認
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <div className="panel-body">
                  {isTranslation ? (
                    <>
                      <div className="view-tabs">
                        <button
                          className={`btn sm ${trView === "bilingual" ? "primary" : ""}`}
                          type="button"
                          onClick={() => setTrView("bilingual")}
                        >
                          対訳
                        </button>
                        <button
                          className={`btn sm ${trView === "target" ? "primary" : ""}`}
                          type="button"
                          onClick={() => setTrView("target")}
                        >
                          訳文
                        </button>
                        <button
                          className={`btn sm ${trView === "diff" ? "primary" : ""}`}
                          type="button"
                          onClick={() => setTrView("diff")}
                          disabled={!currentDraft?.bodyHistory?.length}
                          title={
                            currentDraft?.bodyHistory?.length
                              ? "旧版とのGitHub風差分を表示"
                              : "再生成・編集・置換をすると旧版が退避され、比較できるようになります"
                          }
                        >
                          変更差分{currentDraft?.bodyHistory?.length ? `（${currentDraft.bodyHistory.length}版）` : ""}
                        </button>
                      </div>
                      {trView === "bilingual" ? (
                        <div className="bilingual-grid">
                          <div>
                            <div className="bilingual-label">
                              原文（{(selected.section.sourceText?.length ?? 0).toLocaleString()} 字）
                            </div>
                            <div className="draft-body source-body">
                              {selected.section.sourceText || "（このセグメントに原文がありません）"}
                            </div>
                          </div>
                          <div>
                            <div className="bilingual-label">訳文</div>
                            {currentDraft ? (
                              <div className="draft-body">{currentDraft.body || "（訳文が空です）"}</div>
                            ) : (
                              <div className="empty-state">
                                まだ翻訳されていません。「このセグメントを翻訳」を押してください。
                              </div>
                            )}
                          </div>
                        </div>
                      ) : trView === "target" ? (
                        editingBody ? (
                          <>
                            <textarea
                              className="input mono"
                              rows={18}
                              value={bodyDraft}
                              onChange={(e) => setBodyDraft(e.target.value)}
                            />
                            <div className="flex" style={{ marginTop: 8, gap: 8 }}>
                              <button className="btn primary" type="button" onClick={handleSaveBody}>
                                保存（旧版を退避）
                              </button>
                              <button className="btn" type="button" onClick={() => setEditingBody(false)}>
                                キャンセル
                              </button>
                            </div>
                          </>
                        ) : currentDraft ? (
                          <div className="draft-body">{currentDraft.body || "（訳文が空です）"}</div>
                        ) : (
                          <div className="empty-state">
                            まだ翻訳されていません。「このセグメントを翻訳」を押してください。
                          </div>
                        )
                      ) : currentDraft?.bodyHistory?.length ? (
                        (() => {
                          const history = currentDraft.bodyHistory!;
                          const baseIdx = Math.min(diffBaseIdx ?? history.length - 1, history.length - 1);
                          const base = history[baseIdx];
                          const lines = diffLines(base.body, currentDraft.body);
                          const stats = diffStats(lines);
                          return (
                            <>
                              <div className="flex" style={{ alignItems: "center", gap: 10, marginBottom: 8 }}>
                                <label className="hint" style={{ whiteSpace: "nowrap" }}>比較元の版</label>
                                <select
                                  className="input"
                                  style={{ width: "auto" }}
                                  value={baseIdx}
                                  onChange={(e) => setDiffBaseIdx(Number(e.target.value))}
                                >
                                  {history.map((h, i) => (
                                    <option key={i} value={i}>
                                      {new Date(h.savedAt).toLocaleString("ja-JP")}（{h.note ?? "旧版"}）
                                    </option>
                                  ))}
                                </select>
                                <span className="badge success">+{stats.added} 行</span>
                                <span className="badge danger">−{stats.removed} 行</span>
                              </div>
                              <div className="diff-view">
                                {lines.map((l, i) => (
                                  <div key={i} className={`diff-line ${l.type}`}>
                                    <span className="diff-sign">
                                      {l.type === "add" ? "+" : l.type === "del" ? "-" : " "}
                                    </span>
                                    <span className="diff-text">
                                      {"spans" in l && l.spans
                                        ? l.spans.map((s, si) =>
                                            s.type === "same" ? (
                                              s.text
                                            ) : (
                                              <mark key={si} className={`diff-char-${s.type}`}>{s.text}</mark>
                                            ),
                                          )
                                        : l.text}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </>
                          );
                        })()
                      ) : (
                        <div className="empty-state">
                          まだ比較できる旧版がありません。再翻訳・訳文の編集・一括置換をすると旧版が自動で退避されます。
                        </div>
                      )}
                    </>
                  ) : !currentDraft ? (
                    <div className="empty-state">
                      まだ本文が生成されていません。「この小見出しの本文を生成」を押してください。
                    </div>
                  ) : editingBody ? (
                    <>
                      <textarea
                        className="input mono"
                        rows={18}
                        value={bodyDraft}
                        onChange={(e) => setBodyDraft(e.target.value)}
                      />
                      <div className="flex" style={{ marginTop: 8, gap: 8 }}>
                        <button className="btn primary" type="button" onClick={handleSaveBody}>
                          保存（旧版を退避）
                        </button>
                        <button className="btn" type="button" onClick={() => setEditingBody(false)}>
                          キャンセル
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      {currentDraft.bodyHistory?.length ? (
                        <button
                          className="btn sm"
                          type="button"
                          onClick={() => setShowBodyDiff((v) => !v)}
                          style={{ marginBottom: 8 }}
                        >
                          {showBodyDiff ? "本文に戻す" : `変更差分（${currentDraft.bodyHistory.length}版）`}
                        </button>
                      ) : null}
                      {showBodyDiff && currentDraft.bodyHistory?.length ? (
                        (() => {
                          const hist = currentDraft.bodyHistory;
                          if (!hist?.length) return null;
                          const base = hist[hist.length - 1];
                          const lines = diffLines(base.body, currentDraft.body);
                          const stats = diffStats(lines);
                          return (
                            <div className="draft-body">
                              <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>
                                前の版（{base.savedAt.slice(0, 16).replace("T", " ")}）との差分　+{stats.added} / -{stats.removed}
                              </div>
                              {lines.map((ln, i) => (
                                <div key={i} className={`diff-line ${ln.type}`}>{ln.text || " "}</div>
                              ))}
                            </div>
                          );
                        })()
                      ) : (
                        <div className="draft-body">{currentDraft.body || "（本文が空です）"}</div>
                      )}
                    </>
                  )}
                </div>
              </div>

              {impactItems && impactSource?.chapterId === selected.chapter.id && impactSource?.sectionId === selected.section.id ? (
                <div className="panel">
                  <div className="panel-header">
                    <h2>編集の波及（影響のある節）</h2>
                    {impactItems.length > 0 ? (
                      <button
                        className="btn primary"
                        type="button"
                        onClick={handlePropagate}
                        disabled={propagating}
                      >
                        {propagating ? <span className="spinner" /> : null}
                        {propagating ? "再生成中…" : "影響のある節を再生成"}
                      </button>
                    ) : null}
                  </div>
                  <div className="panel-body dense">
                    {propagateProgress ? (
                      <div className="alert info" style={{ marginBottom: 10 }}>{propagateProgress}</div>
                    ) : null}
                    {impactItems.length === 0 ? (
                      <div className="empty-state">
                        この編集による下流の節への影響は検出されませんでした。
                      </div>
                    ) : (
                      <ul className="list-block">
                        {impactItems.map((it) => {
                          const draft = project.generatedSections.find(
                            (d) => d.chapterId === it.chapterId && d.sectionId === it.sectionId,
                          );
                          const locked = !!draft?.locked;
                          return (
                            <li key={`${it.chapterId}::${it.sectionId}`} className="flex" style={{ gap: 10, alignItems: "flex-start" }}>
                              <span className={`badge ${it.severity === "high" ? "warn" : "gray"}`}>
                                {it.severity === "high" ? "要再生成" : "要確認"}
                              </span>
                              <span style={{ flex: 1 }}>
                                <strong>{it.chapterTitle} / {it.sectionTitle}</strong>
                                <span className="muted" style={{ display: "block", fontSize: 11 }}>{it.reason}</span>
                              </span>
                              <label className="staff-toggle" title="ロックすると波及再生成から保護されます">
                                <input
                                  type="checkbox"
                                  checked={locked}
                                  onChange={(e) => handleToggleLock(it.chapterId, it.sectionId, e.target.checked)}
                                />
                                <span>{locked ? "保護中" : "保護"}</span>
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    <p className="help" style={{ marginTop: 8 }}>
                      「影響のある節を再生成」を押すと、構成順に上流の更新を織り込みながら再生成します。
                      手で直した節は「保護」にチェックすると再生成されません。
                    </p>
                  </div>
                </div>
              ) : null}

              {currentDraft && currentAgentReports.length > 0 ? (
                <div className="panel">
                  <div className="panel-header">
                    <h2>AI編集チーム診断</h2>
                    <span className="hint">
                      本文生成と同時に 4 役のエージェントが並列でチェックしました
                    </span>
                  </div>
                  <div className="panel-body">
                    <div className="agent-badge-row">
                      {currentAgentReports.map((r) => {
                        const total = r.findings.length;
                        const sev = r.findings.some((f) => f.severity === "error")
                          ? "danger"
                          : r.findings.some((f) => f.severity === "warning")
                            ? "warn"
                            : total > 0
                              ? "gray"
                              : "success";
                        return (
                          <span key={r.agent} className={`badge ${sev}`} title={r.agent}>
                            {r.label} · {total} 件
                          </span>
                        );
                      })}
                    </div>
                    <hr className="sep" />
                    <div className="grid grid-2">
                      {currentAgentReports.map((r) => (
                        <div key={r.agent} className="agent-detail-card">
                          <div className="agent-detail-header">
                            <strong>{r.label}</strong>
                            <span className="muted" style={{ fontSize: 11 }}>
                              {r.meta.parseFailed
                                ? "AI応答をパースできず"
                                : `${r.findings.length}件`}
                            </span>
                          </div>
                          <ul className="list-block">
                            {r.findings.length === 0 && !r.meta.parseFailed ? (
                              <li className="muted" style={{ fontSize: 11 }}>
                                指摘なし
                              </li>
                            ) : null}
                            {r.findings.map((f, i) => (
                              <li key={i} className={`finding severity-${f.severity}`}>
                                <div className="finding-message">{f.message}</div>
                                {f.loc ? (
                                  <div className="finding-loc">「{f.loc}」</div>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}

              {currentDraft ? (
                <div className="grid grid-2">
                  <div className="panel">
                    <div className="panel-header">
                      <h2>編集メモ</h2>
                      <span className="hint">{currentDraft.editorNotes.length} 件</span>
                    </div>
                    <ul className="list-block">
                      {currentDraft.editorNotes.length === 0 ? (
                        <li className="muted">編集メモはありません。</li>
                      ) : (
                        currentDraft.editorNotes.map((n, i) => <li key={i}>{n}</li>)
                      )}
                    </ul>
                  </div>
                  <div className="panel">
                    <div className="panel-header">
                      <h2>追加質問</h2>
                      <span className="hint">{currentDraft.followUpQuestions.length} 件</span>
                    </div>
                    <ul className="list-block">
                      {currentDraft.followUpQuestions.length === 0 ? (
                        <li className="muted">追加質問はありません。</li>
                      ) : (
                        currentDraft.followUpQuestions.map((q, i) => <li key={i}>{q}</li>)
                      )}
                    </ul>
                  </div>
                  <div className="panel">
                    <div className="panel-header">
                      <h2>事実確認ポイント</h2>
                      <span className="hint">{currentDraft.factCheckPoints.length} 件</span>
                    </div>
                    <ul className="list-block">
                      {currentDraft.factCheckPoints.length === 0 ? (
                        <li className="muted">事実確認ポイントはありません。</li>
                      ) : (
                        currentDraft.factCheckPoints.map((q, i) => <li key={i}>{q}</li>)
                      )}
                    </ul>
                  </div>
                  <div className="panel">
                    <div className="panel-header">
                      <h2>前後のつながりメモ</h2>
                      <span className="hint">{currentDraft.continuityNotes.length} 件</span>
                    </div>
                    <ul className="list-block">
                      {currentDraft.continuityNotes.length === 0 ? (
                        <li className="muted">つながりメモはありません。</li>
                      ) : (
                        currentDraft.continuityNotes.map((q, i) => <li key={i}>{q}</li>)
                      )}
                    </ul>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </section>
      </div>
    </>
  );
}
