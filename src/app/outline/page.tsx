"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  loadProject,
  loadPrompts,
  selectOutline,
  setOutlineProposals,
} from "@/lib/storage";
import { postJson } from "@/lib/apiClient";
import { buildScreenplayExtraContext, getGenreConfig } from "@/lib/genreConfig";
import type { OutlineProposal, Project } from "@/lib/types";

const DEFAULT_TYPE_LABEL: Record<OutlineProposal["type"], string> = {
  chronological: "時系列型",
  thematic: "テーマ型",
  narrative: "人物伝・読み物型",
};

export default function OutlinePage() {
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setProject(loadProject());
  }, []);

  const genreCfg = getGenreConfig(project?.genre);
  const structureTitle = genreCfg.stages.structure.pageTitle;
  const typeLabel = genreCfg.outlineTypeLabels ?? DEFAULT_TYPE_LABEL;

  if (!project) {
    return (
      <>
        <div className="page-header">
          <div>
            <h1>{structureTitle}</h1>
            <p className="subtitle">AIが提示した3つの構成案から方向性を選びます。</p>
          </div>
        </div>
        <div className="empty-state">読み込み中…</div>
      </>
    );
  }

  async function handleRegenerate() {
    if (!project) return;
    setError(null);
    setLoading(true);
    try {
      const prompts = loadPrompts();
      const promptTemplate = prompts.find((p) => p.id === genreCfg.pipelinePrompts.outline);
      const r = await postJson<{ proposals?: OutlineProposal[] }>("/api/generate-outline", {
        projectName: project.name,
        intervieweeName: project.intervieweeName,
        theme: project.theme,
        targetReader: project.targetReader,
        desiredTone: project.desiredTone,
        interviewNotes: project.interviewNotes,
        promptTemplate,
        extraContext: buildScreenplayExtraContext(project),
      });
      if (!r.ok) {
        setError(r.error ?? "再生成に失敗しました。");
        return;
      }
      const proposals: OutlineProposal[] = Array.isArray(r.data?.proposals)
        ? (r.data!.proposals as OutlineProposal[])
        : [];
      if (proposals.length === 0) {
        setError("AIが構成案を返しませんでした。");
        return;
      }
      const next = setOutlineProposals(proposals);
      setProject(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  function handleSelect(outlineId: string) {
    if (!project) return;
    setError(null);
    const next = selectOutline(outlineId);
    setProject(next);
    if (!next.selectedOutline) {
      setError("選択した構成案が見つかりません。");
      return;
    }
    // 選択後は「構成の調整」画面へ。小見出し生成はそこで行う
    router.push("/outline/refine");
  }

  const proposals = project.outlineProposals ?? [];
  const selectedId = project.selectedOutline?.id;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>{structureTitle}</h1>
          <p className="subtitle">
            AIが3つの構成案を提示します。方向性を選ぶと、次の画面でAIと一緒に構成を調整できます。
          </p>
        </div>
        <div className="actions">
          <Link className="btn" href="/">取材メモへ戻る</Link>
          <button
            className="btn"
            onClick={handleRegenerate}
            disabled={loading}
            type="button"
          >
            {loading ? <span className="spinner" /> : null}
            {loading ? "再生成中…" : "再生成"}
          </button>
        </div>
      </div>

      {error ? <div className="alert" style={{ marginBottom: 16 }}>{error}</div> : null}

      {proposals.length === 0 ? (
        <div className="empty-state">
          まだ構成案がありません。取材メモ画面で「章立て案を生成する」を押してください。
          <div style={{ marginTop: 12 }}>
            <Link className="btn primary" href="/">取材メモへ</Link>
          </div>
        </div>
      ) : (
        <div className="grid grid-3">
          {proposals.map((p, idx) => {
            const isSelected = p.id === selectedId;
            return (
              <section key={p.id} className="panel outline-card">
                <div className="panel-header">
                  <div className="flex" style={{ gap: 8 }}>
                    <span className="badge">構成案 {String.fromCharCode(65 + idx)}</span>
                    <span className="badge gray">{typeLabel[p.type] ?? p.type}</span>
                  </div>
                  <h2 style={{ marginTop: 4 }}>{p.title}</h2>
                </div>
                <div className="panel-body">
                  <p className="concept">{p.concept}</p>
                  <div className="recommended">
                    <strong>おすすめ用途：</strong>
                    {p.recommendedFor}
                  </div>
                  <ol className="chapter-list">
                    {p.chapters.map((c) => (
                      <li key={c.id}>
                        <span className="num">第{c.chapterNumber}章</span>
                        <span>
                          <span className="ttl">{c.title}</span>
                          {c.summary ? <span className="smry">{c.summary}</span> : null}
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
                <div className="panel-body" style={{ borderTop: "1px solid var(--border)", display: "flex", gap: 8, alignItems: "center" }}>
                  {isSelected ? <span className="badge success">選択中</span> : null}
                  <button
                    className="btn primary"
                    style={{ marginLeft: "auto" }}
                    onClick={() => handleSelect(p.id)}
                    type="button"
                  >
                    この案で調整する →
                  </button>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
