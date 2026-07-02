"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  loadProject,
  loadPrompts,
  replaceSelectedOutline,
  saveSectionAgentReports,
  upsertDraft,
  withStyleRules,
} from "@/lib/storage";
import type {
  AgentReportSummary,
  Chapter,
  OutlineProposal,
  Project,
  Section,
  SectionDraft,
} from "@/lib/types";
import { exportProjectDocx, exportSectionDocx } from "@/lib/docx";
import { postJson } from "@/lib/apiClient";
import { getGenreConfig } from "@/lib/genreConfig";

type Selected = { chapter: Chapter; section: Section } | null;

export default function WriterPage() {
  const [project, setProject] = useState<Project | null>(null);
  const [selected, setSelected] = useState<Selected>(null);
  const [loading, setLoading] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [regenSections, setRegenSections] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const p = loadProject();
    setProject(p);
    if (p.selectedOutline?.chapters.length) {
      const firstChapter = p.selectedOutline.chapters[0];
      const firstSection = firstChapter.sections?.[0];
      if (firstSection) setSelected({ chapter: firstChapter, section: firstSection });
    }
  }, []);

  const writingTitle = getGenreConfig(project?.genre).stages.writing.pageTitle;

  const draftMap = useMemo(() => {
    const m = new Map<string, SectionDraft>();
    project?.generatedSections.forEach((d) => m.set(`${d.chapterId}::${d.sectionId}`, d));
    return m;
  }, [project]);

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
    setError(null);
    setLoading(true);
    try {
      const prompts = loadPrompts();
      const base = prompts.find((p) => p.id === "prompt-draft");
      const promptTemplate = base ? withStyleRules(base) : undefined;
      const r = await postJson<{ draft?: SectionDraft; agentReports?: AgentReportSummary[] }>(
        "/api/generate-draft",
        {
          project,
          chapter: selected.chapter,
          section: selected.section,
          promptTemplate,
        },
      );
      if (!r.ok) throw new Error(r.error ?? "本文生成に失敗しました。");
      const draft = r.data?.draft;
      if (!draft) throw new Error("AIから本文が返りませんでした。");
      upsertDraft(draft);
      // 診断結果を project に永続化 (/review 画面の集約元になる)
      const reports = r.data?.agentReports ?? [];
      const key = `${draft.chapterId}::${draft.sectionId}`;
      const next = saveSectionAgentReports(key, reports);
      setProject(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleReview() {
    if (!project || !currentDraft) return;
    setError(null);
    setReviewing(true);
    try {
      const prompts = loadPrompts();
      const base = prompts.find((p) => p.id === "prompt-review");
      const promptTemplate = base ? withStyleRules(base) : undefined;
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
      const r = await postJson<{ outline?: OutlineProposal; parseFailed?: boolean }>(
        "/api/generate-sections",
        {
          selectedOutline: cleared,
          interviewNotes: project.interviewNotes,
          writingMemory: project.writingMemory,
        },
      );
      if (!r.ok) throw new Error(r.error ?? "小見出しの生成に失敗しました。");
      if (!r.data?.outline) throw new Error("APIから構成案が返りませんでした。");
      if (r.data?.parseFailed) {
        throw new Error("AI出力の解釈に失敗しました。もう一度お試しください。");
      }
      const outline = r.data.outline;
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

  async function handleExportSection() {
    if (!project || !currentDraft) return;
    setExporting(true);
    try {
      await exportSectionDocx(project, currentDraft);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  }

  async function handleExportAll() {
    if (!project) return;
    if (project.generatedSections.length === 0) {
      setError("Word出力対象の本文がありません。先に本文を生成してください。");
      return;
    }
    setExporting(true);
    try {
      await exportProjectDocx(project);
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
          <button className="btn" onClick={handleExportAll} disabled={exporting} type="button">
            {exporting ? <span className="spinner" /> : null}
            全体Wordを出力
          </button>
        </div>
      </div>

      {error ? <div className="alert" style={{ marginBottom: 16 }}>{error}</div> : null}

      <div className="writer-shell">
        <aside className="panel">
          <div className="panel-header">
            <h2>章・小見出し</h2>
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
          </div>
          <div className="panel-body dense">
            <ul className="toc">
              {outline.chapters.map((c) => (
                <li key={c.id} className="chapter">
                  <div className="chapter-title">
                    第{c.chapterNumber}章　{c.title}
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
                          onClick={() => setSelected({ chapter: c, section: s })}
                        >
                          <span className="dot" />
                          <span>{s.title}</span>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
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
                  </div>
                  <div className="row-actions">
                    {currentDraft ? (
                      <button
                        className="btn"
                        onClick={() => handleGenerate(true)}
                        disabled={loading}
                        type="button"
                      >
                        {loading ? <span className="spinner" /> : null}
                        本文を再生成
                      </button>
                    ) : (
                      <button
                        className="btn primary"
                        onClick={() => handleGenerate(false)}
                        disabled={loading}
                        type="button"
                      >
                        {loading ? <span className="spinner" /> : null}
                        {loading ? "生成中…" : "この小見出しの本文を生成"}
                      </button>
                    )}
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
                      onClick={handleExportSection}
                      disabled={!currentDraft || exporting}
                      type="button"
                    >
                      Wordで保存
                    </button>
                  </div>
                </div>
                <div className="panel-body">
                  {!currentDraft ? (
                    <div className="empty-state">
                      まだ本文が生成されていません。「この小見出しの本文を生成」を押してください。
                    </div>
                  ) : (
                    <div className="draft-body">{currentDraft.body || "（本文が空です）"}</div>
                  )}
                </div>
              </div>

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
