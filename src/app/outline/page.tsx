"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  loadProject,
  loadPrompts,
  selectOutline,
  setOutlineProposals,
  updateProject,
} from "@/lib/storage";
import { postJson } from "@/lib/apiClient";
import type { OutlineProposal, Project } from "@/lib/types";

const TYPE_LABEL: Record<OutlineProposal["type"], string> = {
  chronological: "時系列型",
  thematic: "テーマ型",
  narrative: "人物伝・読み物型",
};

export default function OutlinePage() {
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(false);
  const [sectionLoading, setSectionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setProject(loadProject());
  }, []);

  if (!project) {
    return (
      <>
        <div className="page-header">
          <div>
            <h1>章立て構成案</h1>
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
      const promptTemplate = prompts.find((p) => p.id === "prompt-outline");
      const r = await postJson<{ proposals?: OutlineProposal[] }>("/api/generate-outline", {
        projectName: project.name,
        intervieweeName: project.intervieweeName,
        theme: project.theme,
        targetReader: project.targetReader,
        desiredTone: project.desiredTone,
        interviewNotes: project.interviewNotes,
        promptTemplate,
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

  async function handleSelect(outlineId: string) {
    if (!project) return;
    setError(null);
    setSectionLoading(true);
    try {
      let next = selectOutline(outlineId);
      setProject(next);
      if (!next.selectedOutline) {
        throw new Error("選択した構成案が見つかりません。");
      }
      const needsSections = next.selectedOutline.chapters.some((c) => !c.sections || c.sections.length === 0);
      if (needsSections) {
        const r = await postJson<{ outline?: OutlineProposal; parseFailed?: boolean }>(
          "/api/generate-sections",
          {
            selectedOutline: next.selectedOutline,
            interviewNotes: next.interviewNotes,
            writingMemory: next.writingMemory,
          },
        );
        if (!r.ok) throw new Error(r.error ?? "小見出しの生成に失敗しました。");
        if (r.data?.outline) {
          next = updateProject((p) => ({
            ...p,
            selectedOutline: r.data!.outline,
          }));
          setProject(next);
        }
        if (r.data?.parseFailed) {
          throw new Error(
            "小見出しの生成に失敗しました（AI出力をJSONとして解釈できませんでした）。もう一度「この構成案で進める」を押してください。",
          );
        }
        const hasAnySection = next.selectedOutline?.chapters.some(
          (c) => c.sections && c.sections.length > 0,
        );
        if (!hasAnySection) {
          throw new Error(
            "小見出しが1件も生成されませんでした。もう一度「この構成案で進める」を押してください。",
          );
        }
      }
      router.push("/writer");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSectionLoading(false);
    }
  }

  const proposals = project.outlineProposals ?? [];
  const selectedId = project.selectedOutline?.id;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>章立て構成案</h1>
          <p className="subtitle">
            AIが3つの構成案を提示します。編集者が方向性を選択してください。
          </p>
        </div>
        <div className="actions">
          <Link className="btn" href="/">取材メモへ戻る</Link>
          <button
            className="btn"
            onClick={handleRegenerate}
            disabled={loading || sectionLoading}
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
                    <span className="badge gray">{TYPE_LABEL[p.type] ?? p.type}</span>
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
                    disabled={sectionLoading}
                    type="button"
                  >
                    {sectionLoading && isSelected ? <span className="spinner" /> : null}
                    {sectionLoading && isSelected ? "小見出し生成中…" : "この構成案で進める"}
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
