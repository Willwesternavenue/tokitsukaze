"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { loadProject, updateGlossary, updateReferences } from "@/lib/storage";
import { makeId } from "@/lib/ids";
import { postJson } from "@/lib/apiClient";
import type { GlossaryTerm, Project, Reference, ReferenceCard } from "@/lib/types";

const CARD_FIELDS: { key: keyof ReferenceCard; label: string; long?: boolean }[] = [
  { key: "refKind", label: "種別（提案手法/実証/総説/データセット 等）" },
  { key: "purpose", label: "目的・RQ", long: true },
  { key: "method", label: "手法の要点", long: true },
  { key: "findings", label: "主要な結果・発見", long: true },
  { key: "contribution", label: "貢献・新規性", long: true },
  { key: "limitations", label: "限界・批判点", long: true },
  { key: "relationToThis", label: "本研究との関係（差分・引用の使いどころ）", long: true },
];

export default function ReferencesPage() {
  const [project, setProject] = useState<Project | null>(null);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setProject(loadProject());
  }, []);

  if (!project) {
    return (
      <>
        <div className="page-header">
          <div>
            <h1>参考文献・用語集</h1>
          </div>
        </div>
        <div className="empty-state">読み込み中…</div>
      </>
    );
  }

  if (project.genre !== "business" && project.genre !== "news" && project.genre !== "paper") {
    return (
      <>
        <div className="page-header">
          <div>
            <h1>参考文献・用語集</h1>
            <p className="subtitle">この画面はビジネス書・ニュース記事・論文モードのプロジェクトでのみ使えます。</p>
          </div>
        </div>
        <div className="empty-state">
          現在のプロジェクトは「{project.genre === "novel" ? "小説" : project.genre === "biography" ? "聞き書き" : project.genre}」モードです。
          <div style={{ marginTop: 12 }}>
            <Link href="/settings" className="btn primary">設定でモードを変更</Link>
          </div>
        </div>
      </>
    );
  }

  const isNews = project.genre === "news";
  const isPaper = project.genre === "paper";

  const references = project.references ?? [];
  const glossary = project.glossary ?? [];

  function persistRefs(next: Reference[]) {
    const updated = updateReferences(next);
    setProject(updated);
  }

  function patchCard(refId: string, patch: Partial<ReferenceCard>) {
    persistRefs(
      references.map((x) =>
        x.id === refId ? { ...x, card: { ...(x.card ?? {}), ...patch } } : x,
      ),
    );
  }

  // 論文モード: 文献ファイル（PDF/Word等）から文献カルテを生成して1件追加
  async function handleImportReference(file: File) {
    setError(null);
    setNotice(null);
    setImporting(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("field", project?.paperMeta?.field ?? "");
      fd.append("researchQuestion", project?.paperMeta?.researchQuestion ?? "");
      const res = await fetch("/api/extract-reference-card", { method: "POST", body: fd });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.reference) {
        throw new Error(data?.error ?? "文献カルテの生成に失敗しました。");
      }
      persistRefs([...references, data.reference as Reference]);
      setNotice(`「${data.reference.title}」の文献カルテを追加しました。内容を確認・修正してください。`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  }

  function persistGlossary(next: GlossaryTerm[]) {
    const updated = updateGlossary(next);
    setProject(updated);
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>{isNews ? "取材源・出典" : isPaper ? "参考文献・文献カルテ" : "参考文献・用語集"}</h1>
          <p className="subtitle">
            {isNews
              ? "登録した取材源・出典は、記事執筆と事実確認エージェントに自動で渡されます。"
              : isPaper
                ? "登録した文献だけが本文の引用マーカー〔著者, 年〕に使えます（未登録は〔要出典〕）。PDFを取り込むと文献カルテ（目的・手法・結果・貢献・限界）を自動抽出し、関連研究・考察の執筆に使われます。"
                : "登録した文献と用語は、本文執筆と出典チェックエージェントに自動で渡されます。"}
          </p>
        </div>
        {isPaper ? (
          <div className="actions">
            <button
              className="btn"
              type="button"
              disabled={importing}
              onClick={() => fileRef.current?.click()}
              title="論文PDF/Word等を取り込み、AIが文献カルテを抽出します"
            >
              {importing ? <span className="spinner" /> : null}
              {importing ? "抽出中…" : "PDFから文献カルテを取り込む"}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.docx,.txt,.md"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleImportReference(f);
                e.target.value = "";
              }}
            />
          </div>
        ) : null}
      </div>

      {error ? <div className="alert" style={{ marginBottom: 16 }}>{error}</div> : null}
      {notice ? <div className="alert info" style={{ marginBottom: 16 }}>{notice}</div> : null}

      <div className="panel">
        <div className="panel-header">
          <h2>参考文献</h2>
          <button
            className="btn sm"
            type="button"
            onClick={() =>
              persistRefs([
                ...references,
                { id: makeId("ref"), title: "", author: "", source: "", year: "", url: "", notes: "" },
              ])
            }
          >
            ＋ 文献を追加
          </button>
        </div>
        <div className="panel-body">
          {references.length === 0 ? (
            <div className="empty-state">
              主張の裏付けに使う書籍・論文・調査・記事を登録します。
              出典チェックエージェントが本文との紐付けを確認します。
            </div>
          ) : (
            references.map((r) => (
              <div
                key={r.id}
                className="field-row"
                style={{ gridTemplateColumns: "1.6fr 1fr 1fr 90px 36px", alignItems: "start" }}
              >
                <div className="field">
                  <label>タイトル</label>
                  <input
                    className="input"
                    type="text"
                    value={r.title}
                    onChange={(e) =>
                      persistRefs(references.map((x) => (x.id === r.id ? { ...x, title: e.target.value } : x)))
                    }
                    placeholder="書名・論文名・調査名"
                  />
                </div>
                <div className="field">
                  <label>著者・発行者</label>
                  <input
                    className="input"
                    type="text"
                    value={r.author ?? ""}
                    onChange={(e) =>
                      persistRefs(references.map((x) => (x.id === r.id ? { ...x, author: e.target.value } : x)))
                    }
                  />
                </div>
                <div className="field">
                  <label>出版社・掲載元</label>
                  <input
                    className="input"
                    type="text"
                    value={r.source ?? ""}
                    onChange={(e) =>
                      persistRefs(references.map((x) => (x.id === r.id ? { ...x, source: e.target.value } : x)))
                    }
                  />
                </div>
                <div className="field">
                  <label>年</label>
                  <input
                    className="input"
                    type="text"
                    value={r.year ?? ""}
                    onChange={(e) =>
                      persistRefs(references.map((x) => (x.id === r.id ? { ...x, year: e.target.value } : x)))
                    }
                    placeholder="2024"
                  />
                </div>
                <div className="field">
                  <label>&nbsp;</label>
                  <button
                    className="btn danger sm"
                    type="button"
                    onClick={() => persistRefs(references.filter((x) => x.id !== r.id))}
                  >
                    ×
                  </button>
                </div>
                <div className="field" style={{ gridColumn: "1 / 3" }}>
                  <label>URL</label>
                  <input
                    className="input"
                    type="text"
                    value={r.url ?? ""}
                    onChange={(e) =>
                      persistRefs(references.map((x) => (x.id === r.id ? { ...x, url: e.target.value } : x)))
                    }
                    placeholder="https://..."
                  />
                </div>
                <div className="field" style={{ gridColumn: "3 / 6" }}>
                  <label>メモ（どの主張の裏付けに使うか）</label>
                  <input
                    className="input"
                    type="text"
                    value={r.notes ?? ""}
                    onChange={(e) =>
                      persistRefs(references.map((x) => (x.id === r.id ? { ...x, notes: e.target.value } : x)))
                    }
                  />
                </div>
                {isPaper ? (
                  <details className="ref-card" style={{ gridColumn: "1 / 6" }} open={!!r.card}>
                    <summary>
                      文献カルテ（関連研究・考察の執筆に使われます）
                      {r.card && Object.values(r.card).some(Boolean) ? "" : "　— 未入力"}
                    </summary>
                    <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
                      {CARD_FIELDS.map((f) => (
                        <div className="field" key={f.key}>
                          <label>{f.label}</label>
                          {f.long ? (
                            <textarea
                              className="input"
                              rows={2}
                              value={r.card?.[f.key] ?? ""}
                              onChange={(e) => patchCard(r.id, { [f.key]: e.target.value })}
                            />
                          ) : (
                            <input
                              className="input"
                              type="text"
                              value={r.card?.[f.key] ?? ""}
                              onChange={(e) => patchCard(r.id, { [f.key]: e.target.value })}
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  </details>
                ) : null}
              </div>
            ))
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h2>用語集</h2>
          <button
            className="btn sm"
            type="button"
            onClick={() =>
              persistGlossary([...glossary, { id: makeId("term"), term: "", definition: "" }])
            }
          >
            ＋ 用語を追加
          </button>
        </div>
        <div className="panel-body">
          {glossary.length === 0 ? (
            <div className="empty-state">
              本書で使う専門用語とその定義を登録します。本文ライターはこの定義に従って用語を使います。
            </div>
          ) : (
            glossary.map((t) => (
              <div
                key={t.id}
                className="field-row"
                style={{ gridTemplateColumns: "220px 1fr 36px", alignItems: "start" }}
              >
                <div className="field">
                  <label>用語</label>
                  <input
                    className="input"
                    type="text"
                    value={t.term}
                    onChange={(e) =>
                      persistGlossary(glossary.map((x) => (x.id === t.id ? { ...x, term: e.target.value } : x)))
                    }
                  />
                </div>
                <div className="field">
                  <label>定義</label>
                  <input
                    className="input"
                    type="text"
                    value={t.definition}
                    onChange={(e) =>
                      persistGlossary(
                        glossary.map((x) => (x.id === t.id ? { ...x, definition: e.target.value } : x)),
                      )
                    }
                  />
                </div>
                <div className="field">
                  <label>&nbsp;</label>
                  <button
                    className="btn danger sm"
                    type="button"
                    onClick={() => persistGlossary(glossary.filter((x) => x.id !== t.id))}
                  >
                    ×
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
