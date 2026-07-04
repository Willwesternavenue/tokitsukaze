"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { loadProject, replaceSelectedOutline } from "@/lib/storage";
import { postJson, startAndPollRun } from "@/lib/apiClient";
import type { SectionsWorkflowResult } from "@/workflows/sections";
import { buildScreenplayExtraContext, getGenreConfig } from "@/lib/genreConfig";
import { makeId } from "@/lib/ids";
import type { Chapter, OutlineProposal, Project } from "@/lib/types";

const UNIT_BY_GENRE: Record<string, string> = {
  biography: "章",
  novel: "章",
  business: "章",
  screenplay: "幕",
  blog: "見出しブロック",
};

export default function OutlineRefinePage() {
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [wholeInstruction, setWholeInstruction] = useState("");
  const [refiningWhole, setRefiningWhole] = useState(false);
  const [chapterInstruction, setChapterInstruction] = useState<Record<string, string>>({});
  const [refiningChapterId, setRefiningChapterId] = useState<string | null>(null);
  const [proceeding, setProceeding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    setProject(loadProject());
  }, []);

  if (!project) {
    return (
      <>
        <div className="page-header"><div><h1>構成の調整</h1></div></div>
        <div className="empty-state">読み込み中…</div>
      </>
    );
  }

  const config = getGenreConfig(project.genre);
  const unit = UNIT_BY_GENRE[project.genre] ?? "章";
  const outline = project.selectedOutline;

  if (!outline) {
    return (
      <>
        <div className="page-header">
          <div>
            <h1>構成の調整</h1>
            <p className="subtitle">構成案がまだ選ばれていません。</p>
          </div>
        </div>
        <div className="empty-state">
          先に構成案画面で1案を選んでください。
          <div style={{ marginTop: 12 }}>
            <Link className="btn primary" href="/outline">構成案画面へ</Link>
          </div>
        </div>
      </>
    );
  }

  function persist(next: OutlineProposal) {
    const p = replaceSelectedOutline(next);
    setProject(p);
  }

  // ===== 手動編集 =====
  function updateChapter(id: string, patch: Partial<Chapter>) {
    persist({
      ...outline!,
      chapters: outline!.chapters.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    });
  }
  function addChapter() {
    const next = [...outline!.chapters];
    next.push({
      id: `chapter-${makeId("c")}`,
      chapterNumber: next.length + 1,
      title: `新しい${unit}`,
      summary: "",
      sections: [],
    });
    persist({ ...outline!, chapters: renumber(next) });
  }
  function removeChapter(id: string) {
    if (outline!.chapters.length <= 1) return;
    persist({ ...outline!, chapters: renumber(outline!.chapters.filter((c) => c.id !== id)) });
  }
  function move(id: string, dir: -1 | 1) {
    const arr = [...outline!.chapters];
    const i = arr.findIndex((c) => c.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    persist({ ...outline!, chapters: renumber(arr) });
  }
  function renumber(arr: Chapter[]): Chapter[] {
    return arr.map((c, i) => ({ ...c, chapterNumber: i + 1 }));
  }

  // ===== AI: 全体改善 =====
  async function handleRefineWhole() {
    if (!wholeInstruction.trim()) {
      setError("改善したい方向性を入力してください。");
      return;
    }
    setError(null);
    setInfo(null);
    setRefiningWhole(true);
    try {
      const r = await postJson<{ outline?: OutlineProposal }>("/api/refine-outline", {
        outline,
        instruction: wholeInstruction,
        scope: "whole",
        genreLabel: config.label,
        unit,
      });
      if (!r.ok) throw new Error(r.error ?? "改善に失敗しました。");
      if (r.data?.outline) {
        persist(r.data.outline);
        setInfo("AIが構成を改善しました。内容を確認してください。");
        setWholeInstruction("");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefiningWhole(false);
    }
  }

  // ===== AI: 章ごと修正 =====
  async function handleRefineChapter(chapterId: string) {
    const instruction = (chapterInstruction[chapterId] ?? "").trim();
    if (!instruction) {
      setError("この" + unit + "の修正指示を入力してください。");
      return;
    }
    setError(null);
    setInfo(null);
    setRefiningChapterId(chapterId);
    try {
      const r = await postJson<{ outline?: OutlineProposal }>("/api/refine-outline", {
        outline,
        instruction,
        scope: "chapter",
        chapterId,
        genreLabel: config.label,
        unit,
      });
      if (!r.ok) throw new Error(r.error ?? "修正に失敗しました。");
      if (r.data?.outline) {
        persist(r.data.outline);
        setChapterInstruction((prev) => ({ ...prev, [chapterId]: "" }));
        setInfo(`第${outline!.chapters.find((c) => c.id === chapterId)?.chapterNumber}${unit}を修正しました。`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefiningChapterId(null);
    }
  }

  // ===== 進める（小見出し生成 → writer）=====
  async function handleProceed() {
    setError(null);
    setProceeding(true);
    try {
      // 既存の小見出しは作り直す（構成を編集したため）
      const cleared = { ...outline!, chapters: outline!.chapters.map((c) => ({ ...c, sections: [] })) };
      const r = await startAndPollRun<SectionsWorkflowResult>("/api/generate-sections", {
        selectedOutline: cleared,
        interviewNotes: project!.interviewNotes,
        writingMemory: project!.writingMemory,
        genre: project!.genre,
        extraContext: buildScreenplayExtraContext(project!),
      });
      if (!r.ok) throw new Error(r.error);
      if (!r.result.ok) throw new Error("AI出力の解釈に失敗しました。もう一度お試しください。");
      const nextOutline = r.result.outline;
      const total = (nextOutline.chapters ?? []).reduce(
        (sum, c) => sum + (c.sections?.length ?? 0),
        0,
      );
      if (total === 0) throw new Error("小見出しが1件も生成されませんでした。もう一度お試しください。");
      replaceSelectedOutline(nextOutline);
      router.push("/writer");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProceeding(false);
    }
  }

  const busy = refiningWhole || refiningChapterId !== null || proceeding;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>構成の調整</h1>
          <p className="subtitle">
            選んだ構成：<strong>{outline.title}</strong>。
            AIに改善させたり、{unit}を直接編集してから、小見出し生成へ進みます。
          </p>
        </div>
        <div className="actions">
          <Link className="btn" href="/outline">構成案を選び直す</Link>
          <button className="btn primary lg" onClick={handleProceed} disabled={busy} type="button">
            {proceeding ? <span className="spinner" /> : null}
            {proceeding ? "小見出しを生成中…" : "この構成で進める →"}
          </button>
        </div>
      </div>

      {error ? <div className="alert" style={{ marginBottom: 16 }}>{error}</div> : null}
      {info ? <div className="alert info" style={{ marginBottom: 16 }}>{info}</div> : null}

      <div className="panel">
        <div className="panel-header">
          <h2>AIで全体を改善</h2>
          <span className="hint">例：起承転結を明確に / 章数を減らして / 中盤を厚く</span>
        </div>
        <div className="panel-body">
          <div className="flex" style={{ alignItems: "flex-start" }}>
            <textarea
              className="input"
              rows={2}
              value={wholeInstruction}
              onChange={(e) => setWholeInstruction(e.target.value)}
              placeholder={`この構成をどう改善したいか指示してください（${unit}の追加・削除・統合・順序変更・具体化など）`}
              style={{ flex: 1 }}
            />
            <button
              className="btn primary"
              type="button"
              onClick={handleRefineWhole}
              disabled={busy}
              style={{ whiteSpace: "nowrap" }}
            >
              {refiningWhole ? <span className="spinner" /> : null}
              AIで改善
            </button>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h2>{unit}構成（手動編集・{unit}ごとのAI修正）</h2>
          <button className="btn sm" type="button" onClick={addChapter} disabled={busy}>
            ＋ {unit}を追加
          </button>
        </div>
        <div className="panel-body">
          {outline.chapters.map((c, idx) => (
            <div key={c.id} className="refine-chapter">
              <div className="refine-chapter-head">
                <span className="badge gray">第{c.chapterNumber}{unit}</span>
                <div className="refine-chapter-moves">
                  <button className="btn sm" type="button" onClick={() => move(c.id, -1)} disabled={idx === 0 || busy} title="上へ">↑</button>
                  <button className="btn sm" type="button" onClick={() => move(c.id, 1)} disabled={idx === outline.chapters.length - 1 || busy} title="下へ">↓</button>
                  <button className="btn danger sm" type="button" onClick={() => removeChapter(c.id)} disabled={outline.chapters.length <= 1 || busy} title="削除">×</button>
                </div>
              </div>
              <div className="field" style={{ marginBottom: 8 }}>
                <input
                  className="input"
                  type="text"
                  value={c.title}
                  onChange={(e) => updateChapter(c.id, { title: e.target.value })}
                  placeholder={`${unit}タイトル`}
                />
              </div>
              <div className="field" style={{ marginBottom: 8 }}>
                <textarea
                  className="input"
                  rows={2}
                  value={c.summary}
                  onChange={(e) => updateChapter(c.id, { summary: e.target.value })}
                  placeholder="この章の概要（何が語られるか）"
                />
              </div>
              <div className="flex" style={{ alignItems: "flex-start" }}>
                <input
                  className="input"
                  type="text"
                  value={chapterInstruction[c.id] ?? ""}
                  onChange={(e) =>
                    setChapterInstruction((prev) => ({ ...prev, [c.id]: e.target.value }))
                  }
                  placeholder={`この${unit}をAIで修正する指示（例：もっと具体的に / 前${unit}と統合）`}
                  style={{ flex: 1 }}
                />
                <button
                  className="btn"
                  type="button"
                  onClick={() => handleRefineChapter(c.id)}
                  disabled={busy}
                  style={{ whiteSpace: "nowrap" }}
                >
                  {refiningChapterId === c.id ? <span className="spinner" /> : null}
                  AIで修正
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
