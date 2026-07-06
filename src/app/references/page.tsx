"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { loadProject, updateGlossary, updateReferences } from "@/lib/storage";
import { makeId } from "@/lib/ids";
import type { GlossaryTerm, Project, Reference } from "@/lib/types";

export default function ReferencesPage() {
  const [project, setProject] = useState<Project | null>(null);

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

  if (project.genre !== "business" && project.genre !== "news") {
    return (
      <>
        <div className="page-header">
          <div>
            <h1>参考文献・用語集</h1>
            <p className="subtitle">この画面はビジネス書・ニュース記事モードのプロジェクトでのみ使えます。</p>
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

  const references = project.references ?? [];
  const glossary = project.glossary ?? [];

  function persistRefs(next: Reference[]) {
    const updated = updateReferences(next);
    setProject(updated);
  }

  function persistGlossary(next: GlossaryTerm[]) {
    const updated = updateGlossary(next);
    setProject(updated);
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>{isNews ? "取材源・出典" : "参考文献・用語集"}</h1>
          <p className="subtitle">
            {isNews
              ? "登録した取材源・出典は、記事執筆と事実確認エージェントに自動で渡されます。"
              : "登録した文献と用語は、本文執筆と出典チェックエージェントに自動で渡されます。"}
          </p>
        </div>
      </div>

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
