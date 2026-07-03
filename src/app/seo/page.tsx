"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { loadProject, updateBlogMeta } from "@/lib/storage";
import type { BlogMeta, Project } from "@/lib/types";

const EMPTY: BlogMeta = {
  targetKeyword: "",
  secondaryKeywords: [],
  searchIntent: "",
  persona: "",
  metaDescription: "",
};

export default function SeoPage() {
  const [project, setProject] = useState<Project | null>(null);
  const [kwDraft, setKwDraft] = useState("");

  useEffect(() => {
    setProject(loadProject());
  }, []);

  if (!project) {
    return (
      <>
        <div className="page-header">
          <div>
            <h1>キーワード・ペルソナ</h1>
          </div>
        </div>
        <div className="empty-state">読み込み中…</div>
      </>
    );
  }

  if (project.genre !== "blog") {
    return (
      <>
        <div className="page-header">
          <div>
            <h1>キーワード・ペルソナ</h1>
            <p className="subtitle">この画面はブログ記事モードのプロジェクトでのみ使えます。</p>
          </div>
        </div>
        <div className="empty-state">
          現在のプロジェクトのモードではこの画面は使いません。
          <div style={{ marginTop: 12 }}>
            <Link href="/settings" className="btn primary">設定でモードを変更</Link>
          </div>
        </div>
      </>
    );
  }

  const meta: BlogMeta = { ...EMPTY, ...(project.blogMeta ?? {}) };

  function persist(next: Partial<BlogMeta>) {
    const merged: BlogMeta = { ...meta, ...next };
    const p = updateBlogMeta(merged);
    setProject(p);
  }

  function addKeyword() {
    const v = kwDraft.trim();
    if (!v) return;
    persist({ secondaryKeywords: [...meta.secondaryKeywords, v] });
    setKwDraft("");
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>キーワード・ペルソナ</h1>
          <p className="subtitle">
            対策キーワード・検索意図・ペルソナは、構成生成・本文執筆・SEOチェックに自動で渡されます。
          </p>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header"><h2>キーワード</h2></div>
        <div className="panel-body">
          <div className="field">
            <label>対策キーワード（メインで狙う検索語）</label>
            <input
              className="input"
              type="text"
              value={meta.targetKeyword}
              onChange={(e) => persist({ targetKeyword: e.target.value })}
              placeholder="例：生成AI 議事録 自動化"
            />
          </div>
          <div className="field">
            <label>関連キーワード</label>
            <div className="tag-list" style={{ marginBottom: 6 }}>
              {meta.secondaryKeywords.length === 0 ? (
                <span className="muted" style={{ fontSize: 12 }}>—</span>
              ) : null}
              {meta.secondaryKeywords.map((k, i) => (
                <span className="tag" key={`${k}-${i}`}>
                  {k}
                  <button
                    type="button"
                    onClick={() =>
                      persist({ secondaryKeywords: meta.secondaryKeywords.filter((_, j) => j !== i) })
                    }
                    aria-label="削除"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <div className="flex">
              <input
                className="input"
                type="text"
                value={kwDraft}
                onChange={(e) => setKwDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addKeyword();
                  }
                }}
                placeholder="関連語を追加して Enter"
              />
              <button className="btn" type="button" onClick={addKeyword}>追加</button>
            </div>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header"><h2>検索意図・ペルソナ</h2></div>
        <div className="panel-body">
          <div className="field">
            <label>検索意図（この検索の背後で読者が本当に知りたいこと）</label>
            <textarea
              className="input"
              rows={3}
              value={meta.searchIntent}
              onChange={(e) => persist({ searchIntent: e.target.value })}
              placeholder="例：ツールの比較ではなく、無料でどこまでできるか・実際の導入手順を知りたい"
            />
          </div>
          <div className="field">
            <label>想定読者（ペルソナ）</label>
            <textarea
              className="input"
              rows={3}
              value={meta.persona}
              onChange={(e) => persist({ persona: e.target.value })}
              placeholder="例：中小企業の情シス担当。ITリテラシーは中程度。コストと運用負荷を気にする"
            />
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h2>メタディスクリプション</h2>
          <span className="hint">SEOチェックが本文から案を提案します</span>
        </div>
        <div className="panel-body">
          <div className="field">
            <label>メタディスクリプション（120字程度）</label>
            <textarea
              className="input"
              rows={3}
              value={meta.metaDescription}
              onChange={(e) => persist({ metaDescription: e.target.value })}
              placeholder="検索結果に表示される説明文。本文生成後、レビュー画面のSEOチェックが案を出します。"
            />
            <p className="help">{meta.metaDescription.length} 文字（推奨: 120字前後）</p>
          </div>
        </div>
      </div>
    </>
  );
}
