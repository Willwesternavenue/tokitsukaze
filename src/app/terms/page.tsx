"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { loadProject, replaceDraftBody, updateTermPairs } from "@/lib/storage";
import { makeId } from "@/lib/ids";
import { postJson } from "@/lib/apiClient";
import type { Project, TermPair } from "@/lib/types";

/**
 * 翻訳書モード: 対訳表・用語のローカライズ作業台。
 * - 対訳表（TermPair）のCRUD + AI候補抽出
 * - 全セグメント横断の用語検索
 * - 訳文への一括置換（旧版を bodyHistory に退避）
 * - 表記揺れスキャン（対訳表の variants を決定論的に走査）
 */

type SearchHit = {
  chapterTitle: string;
  sectionTitle: string;
  where: "source" | "target";
  context: string;
};

type ReplacePreview = {
  chapterId: string;
  sectionId: string;
  chapterTitle: string;
  sectionTitle: string;
  count: number;
};

type VariantHit = {
  term: TermPair;
  variant: string;
  total: number;
  sections: ReplacePreview[];
};

function countOccurrences(text: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = text.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
}

function contextSnippet(text: string, needle: string, radius = 36): string {
  const idx = text.indexOf(needle);
  if (idx < 0) return "";
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + needle.length + radius);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).replace(/\n/g, " ")}${end < text.length ? "…" : ""}`;
}

export default function TermsPage() {
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  // 検索
  const [query, setQuery] = useState("");
  // 一括置換
  const [replaceFrom, setReplaceFrom] = useState("");
  const [replaceTo, setReplaceTo] = useState("");
  const [replacePreview, setReplacePreview] = useState<ReplacePreview[] | null>(null);
  const [replacing, setReplacing] = useState(false);

  useEffect(() => {
    setProject(loadProject());
  }, []);

  const terms = useMemo(() => project?.termPairs ?? [], [project]);

  // 章・セグメント + 訳文の平坦リスト（検索・置換・スキャンの走査対象）
  const flatSections = useMemo(() => {
    if (!project?.selectedOutline) return [];
    const out: {
      chapterId: string;
      sectionId: string;
      chapterTitle: string;
      sectionTitle: string;
      sourceText: string;
      body: string;
    }[] = [];
    for (const c of project.selectedOutline.chapters) {
      for (const s of c.sections ?? []) {
        const draft = project.generatedSections.find(
          (d) => d.chapterId === c.id && d.sectionId === s.id,
        );
        out.push({
          chapterId: c.id,
          sectionId: s.id,
          chapterTitle: c.title,
          sectionTitle: s.title,
          sourceText: s.sourceText ?? "",
          body: draft?.body ?? "",
        });
      }
    }
    return out;
  }, [project]);

  const searchHits: SearchHit[] = useMemo(() => {
    const q = query.trim();
    if (!q) return [];
    const hits: SearchHit[] = [];
    for (const s of flatSections) {
      if (s.sourceText.includes(q)) {
        hits.push({
          chapterTitle: s.chapterTitle,
          sectionTitle: s.sectionTitle,
          where: "source",
          context: contextSnippet(s.sourceText, q),
        });
      }
      if (s.body.includes(q)) {
        hits.push({
          chapterTitle: s.chapterTitle,
          sectionTitle: s.sectionTitle,
          where: "target",
          context: contextSnippet(s.body, q),
        });
      }
      if (hits.length >= 60) break;
    }
    return hits;
  }, [query, flatSections]);

  // 表記揺れスキャン: variants が訳文に出現していないか（確定訳語とのミスマッチ）
  const variantHits: VariantHit[] = useMemo(() => {
    const out: VariantHit[] = [];
    for (const t of terms) {
      for (const v of t.variants ?? []) {
        const needle = v.trim();
        if (!needle || needle === t.target) continue;
        const sections: ReplacePreview[] = [];
        let total = 0;
        for (const s of flatSections) {
          const c = countOccurrences(s.body, needle);
          if (c > 0) {
            total += c;
            sections.push({
              chapterId: s.chapterId,
              sectionId: s.sectionId,
              chapterTitle: s.chapterTitle,
              sectionTitle: s.sectionTitle,
              count: c,
            });
          }
        }
        if (total > 0) out.push({ term: t, variant: needle, total, sections });
      }
    }
    return out;
  }, [terms, flatSections]);

  if (!project) {
    return (
      <>
        <div className="page-header">
          <div><h1>対訳表・用語</h1></div>
        </div>
        <div className="empty-state">読み込み中…</div>
      </>
    );
  }

  if (project.genre !== "translation") {
    return (
      <>
        <div className="page-header">
          <div>
            <h1>対訳表・用語</h1>
            <p className="subtitle">この画面は翻訳書モードのプロジェクトでのみ使えます。</p>
          </div>
        </div>
        <div className="empty-state">
          プロジェクトのモードを「翻訳書」に切り替えると、対訳表・用語検索・一括置換・表記揺れスキャンが使えます。
          <div style={{ marginTop: 12 }}>
            <Link href="/" className="btn primary">素材入力でモードを変更</Link>
          </div>
        </div>
      </>
    );
  }

  function persistTerms(next: TermPair[]) {
    const updated = updateTermPairs(next);
    setProject(updated);
  }

  function patchTerm(id: string, patch: Partial<TermPair>) {
    persistTerms(terms.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  function addTerm() {
    persistTerms([
      ...terms,
      { id: makeId("term"), source: "", target: "", variants: [], status: "confirmed" },
    ]);
  }

  function removeTerm(id: string) {
    persistTerms(terms.filter((t) => t.id !== id));
  }

  async function handleExtract() {
    if (!project) return;
    setError(null);
    setInfo(null);
    const pairs = flatSections
      .filter((s) => s.sourceText && s.body)
      .slice(0, 6)
      .map((s) => ({ source: s.sourceText, target: s.body }));
    if (pairs.length === 0) {
      setError("翻訳済みのセグメントがまだありません。先に翻訳画面でセグメントを翻訳してください。");
      return;
    }
    setExtracting(true);
    try {
      const r = await postJson<{ terms?: TermPair[] }>("/api/extract-terms", {
        pairs,
        existingTerms: terms.map((t) => ({ source: t.source, target: t.target })),
      });
      if (!r.ok) throw new Error(r.error ?? "用語抽出に失敗しました。");
      const incoming = r.data?.terms ?? [];
      const known = new Set(terms.map((t) => t.source.toLowerCase()));
      const fresh = incoming.filter((t) => !known.has(t.source.toLowerCase()));
      if (fresh.length === 0) {
        setInfo("新しい用語候補は見つかりませんでした。");
      } else {
        persistTerms([...terms, ...fresh]);
        setInfo(`${fresh.length} 件の候補を追加しました。内容を確認して「確定」してください。`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExtracting(false);
    }
  }

  function buildReplacePreview(from: string): ReplacePreview[] {
    const needle = from;
    const out: ReplacePreview[] = [];
    for (const s of flatSections) {
      const c = countOccurrences(s.body, needle);
      if (c > 0) {
        out.push({
          chapterId: s.chapterId,
          sectionId: s.sectionId,
          chapterTitle: s.chapterTitle,
          sectionTitle: s.sectionTitle,
          count: c,
        });
      }
    }
    return out;
  }

  function handlePreviewReplace() {
    setError(null);
    setInfo(null);
    if (!replaceFrom) {
      setError("置換する語（変更前）を入力してください。");
      return;
    }
    setReplacePreview(buildReplacePreview(replaceFrom));
  }

  function applyReplace(from: string, to: string, targets: ReplacePreview[], note: string) {
    if (!from || targets.length === 0) return 0;
    setReplacing(true);
    try {
      let latest: Project | null = null;
      let total = 0;
      for (const t of targets) {
        const sec = flatSections.find(
          (s) => s.chapterId === t.chapterId && s.sectionId === t.sectionId,
        );
        if (!sec || !sec.body.includes(from)) continue;
        total += countOccurrences(sec.body, from);
        latest = replaceDraftBody(t.chapterId, t.sectionId, sec.body.split(from).join(to), note);
      }
      if (latest) setProject(latest);
      return total;
    } finally {
      setReplacing(false);
    }
  }

  function handleApplyReplace() {
    if (!replacePreview || replacePreview.length === 0) return;
    if (
      !confirm(
        `${replacePreview.length} セグメント・計 ${replacePreview.reduce((a, x) => a + x.count, 0)} 箇所を「${replaceFrom}」→「${replaceTo}」に置換します。旧版は各セグメントの変更差分に退避されます。よろしいですか？`,
      )
    ) {
      return;
    }
    const total = applyReplace(replaceFrom, replaceTo, replacePreview, "一括置換前");
    setReplacePreview(null);
    setInfo(`${total} 箇所を置換しました。翻訳画面の「変更差分」タブで確認できます。`);
  }

  function handleFixVariant(hit: VariantHit) {
    if (
      !confirm(
        `表記揺れ「${hit.variant}」を確定訳語「${hit.term.target}」に統一します（${hit.total} 箇所）。よろしいですか？`,
      )
    ) {
      return;
    }
    const total = applyReplace(hit.variant, hit.term.target, hit.sections, "表記揺れ統一前");
    setInfo(`「${hit.variant}」→「${hit.term.target}」：${total} 箇所を統一しました。`);
  }

  const candidateCount = terms.filter((t) => t.status === "candidate").length;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>対訳表・用語</h1>
          <p className="subtitle">
            確定した訳語は翻訳者と用語統一チェックに自動で渡されます。表記揺れの検出にも使われます。
          </p>
        </div>
        <div className="actions">
          <button className="btn" onClick={handleExtract} disabled={extracting} type="button">
            {extracting ? <span className="spinner" /> : null}
            {extracting ? "抽出中…" : "AIで用語を抽出"}
          </button>
          <button className="btn primary" onClick={addTerm} type="button">
            ＋ 用語を追加
          </button>
        </div>
      </div>

      {error ? <div className="alert" style={{ marginBottom: 16 }}>{error}</div> : null}
      {info ? <div className="alert info" style={{ marginBottom: 16 }}>{info}</div> : null}

      <div className="panel">
        <div className="panel-header">
          <h2>対訳表（{terms.length} 語{candidateCount > 0 ? ` / 候補 ${candidateCount}` : ""}）</h2>
          <span className="hint">原語 → 確定訳語。NG表記に入れた語は表記揺れスキャンの対象になります</span>
        </div>
        <div className="panel-body dense">
          {terms.length === 0 ? (
            <div className="empty-state">
              まだ用語がありません。「AIで用語を抽出」で翻訳済みセグメントから候補を集めるか、「＋ 用語を追加」で手動登録してください。
            </div>
          ) : (
            <div className="term-table">
              <div className="term-row term-head">
                <span>原語</span>
                <span>確定訳語</span>
                <span>NG表記（読点区切り）</span>
                <span>メモ</span>
                <span>状態</span>
                <span />
              </div>
              {terms.map((t) => (
                <div key={t.id} className={`term-row ${t.status === "candidate" ? "candidate" : ""}`}>
                  <input
                    className="input"
                    value={t.source}
                    onChange={(e) => patchTerm(t.id, { source: e.target.value })}
                    placeholder="原語"
                  />
                  <input
                    className="input"
                    value={t.target}
                    onChange={(e) => patchTerm(t.id, { target: e.target.value })}
                    placeholder="確定訳語"
                  />
                  <input
                    className="input"
                    value={(t.variants ?? []).join("、")}
                    onChange={(e) =>
                      patchTerm(t.id, {
                        variants: e.target.value
                          .split(/[、,]/)
                          .map((v) => v.trim())
                          .filter(Boolean),
                      })
                    }
                    placeholder="例：サーバ"
                  />
                  <input
                    className="input"
                    value={t.notes ?? ""}
                    onChange={(e) => patchTerm(t.id, { notes: e.target.value })}
                    placeholder="文脈・使い分け"
                  />
                  {t.status === "candidate" ? (
                    <button
                      className="btn sm"
                      type="button"
                      title="候補を確定訳語として採用する"
                      onClick={() => patchTerm(t.id, { status: "confirmed" })}
                    >
                      確定する
                    </button>
                  ) : (
                    <span className="badge success">確定</span>
                  )}
                  <button className="btn sm danger" type="button" onClick={() => removeTerm(t.id)}>
                    削除
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-2">
        <div className="panel">
          <div className="panel-header">
            <h2>用語検索（原文・訳文横断）</h2>
            <span className="hint">全 {flatSections.length} セグメントを検索</span>
          </div>
          <div className="panel-body dense">
            <input
              className="input"
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="検索語（例：distributed / 分散システム）"
            />
            {query.trim() ? (
              <ul className="list-block" style={{ marginTop: 10 }}>
                {searchHits.length === 0 ? (
                  <li className="muted">ヒットなし</li>
                ) : (
                  searchHits.map((h, i) => (
                    <li key={i}>
                      <span className={`badge ${h.where === "source" ? "gray" : "success"}`}>
                        {h.where === "source" ? "原文" : "訳文"}
                      </span>{" "}
                      <strong>{h.chapterTitle} / {h.sectionTitle}</strong>
                      <span className="muted" style={{ display: "block", fontSize: 11 }}>{h.context}</span>
                    </li>
                  ))
                )}
              </ul>
            ) : (
              <p className="help" style={{ marginTop: 8 }}>
                原語の出現箇所と訳され方を確認できます。訳語を決めたら対訳表に登録してください。
              </p>
            )}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <h2>一括置換（訳文）</h2>
            <span className="hint">旧版は変更差分に退避されます</span>
          </div>
          <div className="panel-body dense">
            <div className="field-row">
              <div className="field">
                <label>変更前</label>
                <input
                  className="input"
                  value={replaceFrom}
                  onChange={(e) => {
                    setReplaceFrom(e.target.value);
                    setReplacePreview(null);
                  }}
                  placeholder="例：サーバ"
                />
              </div>
              <div className="field">
                <label>変更後</label>
                <input
                  className="input"
                  value={replaceTo}
                  onChange={(e) => setReplaceTo(e.target.value)}
                  placeholder="例：サーバー"
                />
              </div>
            </div>
            <div className="flex" style={{ gap: 8 }}>
              <button className="btn" type="button" onClick={handlePreviewReplace}>
                置換箇所をプレビュー
              </button>
              <button
                className="btn primary"
                type="button"
                onClick={handleApplyReplace}
                disabled={replacing || !replacePreview || replacePreview.length === 0}
              >
                {replacing ? <span className="spinner" /> : null}
                置換を実行
              </button>
            </div>
            {replacePreview ? (
              <ul className="list-block" style={{ marginTop: 10 }}>
                {replacePreview.length === 0 ? (
                  <li className="muted">訳文に「{replaceFrom}」は見つかりませんでした。</li>
                ) : (
                  replacePreview.map((p) => (
                    <li key={`${p.chapterId}::${p.sectionId}`}>
                      <strong>{p.chapterTitle} / {p.sectionTitle}</strong>
                      <span className="badge warn" style={{ marginLeft: 8 }}>{p.count} 箇所</span>
                    </li>
                  ))
                )}
              </ul>
            ) : null}
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h2>表記揺れスキャン</h2>
          <span className="hint">
            対訳表の「NG表記」を全訳文から走査します（AIを使わない即時チェック）
          </span>
        </div>
        <div className="panel-body dense">
          {terms.every((t) => (t.variants ?? []).length === 0) ? (
            <div className="empty-state">
              スキャン対象がありません。対訳表の「NG表記」に揺れやすい表記（例：確定訳語「サーバー」に対する「サーバ」）を登録すると、ここで検出・一括統一できます。
            </div>
          ) : variantHits.length === 0 ? (
            <div className="empty-state">表記揺れは検出されませんでした。</div>
          ) : (
            <ul className="list-block">
              {variantHits.map((h, i) => (
                <li key={i} className="flex" style={{ gap: 10, alignItems: "center" }}>
                  <span className="badge warn">{h.total} 箇所</span>
                  <span style={{ flex: 1 }}>
                    「<strong>{h.variant}</strong>」が使われています（確定訳語:「{h.term.target}」/ 原語: {h.term.source}）
                    <span className="muted" style={{ display: "block", fontSize: 11 }}>
                      {h.sections.map((s) => `${s.chapterTitle}/${s.sectionTitle}（${s.count}）`).join("、")}
                    </span>
                  </span>
                  <button
                    className="btn sm"
                    type="button"
                    disabled={replacing}
                    onClick={() => handleFixVariant(h)}
                  >
                    「{h.term.target}」に統一
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
