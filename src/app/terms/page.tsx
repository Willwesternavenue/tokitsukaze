"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { saveAs } from "file-saver";
import {
  createTermSet,
  deleteTermSet,
  effectiveTermPairs,
  getReferencedTermSets,
  loadProject,
  loadTermSets,
  replaceDraftBody,
  setProjectTermSetIds,
  updateTermPairs,
} from "@/lib/storage";
import { makeId } from "@/lib/ids";
import { postJson } from "@/lib/apiClient";
import { generateSectionDraft } from "@/lib/translationClient";
import type { Project, TermPair, TermSet } from "@/lib/types";

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

// ===== 決定論的QAスキャン用ヘルパ =====

/** 全角数字→半角、桁区切りカンマ除去（数値突き合わせ用の正規化） */
function normalizeDigits(text: string): string {
  return text
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/(\d)[,，](?=\d{3})/g, "$1");
}

/** 原文から突き合わせ対象の数値トークンを抽出（1桁だけの数字はノイズが多いので除外） */
function extractNumbers(text: string): string[] {
  const normalized = normalizeDigits(text);
  const tokens = normalized.match(/\d+(?:\.\d+)?/g) ?? [];
  return [...new Set(tokens.filter((t) => t.length >= 2 || Number(t) >= 10))];
}

function countParagraphs(text: string): number {
  return text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean).length;
}

type QaIssue = { kind: "number" | "paragraph" | "ratio"; message: string };
type QaFinding = {
  chapterId: string;
  sectionId: string;
  chapterTitle: string;
  sectionTitle: string;
  issues: QaIssue[];
};

// ===== CSV 入出力用ヘルパ =====

function csvEscape(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** ダブルクォート対応の簡易CSVパーサ（区切りはカンマ/タブを自動判定） */
function parseCsv(text: string): string[][] {
  const delim = text.includes("\t") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  const src = text.replace(/\r\n?/g, "\n");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      row.push(cell); cell = "";
    } else if (ch === "\n") {
      row.push(cell); cell = "";
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

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
  // 用語の適用チェック → 一括再翻訳
  const [retermProgress, setRetermProgress] = useState<string | null>(null);
  const retermCancelRef = useRef(false);
  const importFileRef = useRef<HTMLInputElement>(null);

  // グローバル対訳表（シリーズ物・分野術語集の使い回し）
  const [allSets, setAllSets] = useState<TermSet[]>([]);

  useEffect(() => {
    setProject(loadProject());
    setAllSets(loadTermSets());
  }, []);

  // プロジェクト固有の対訳表（編集可能な表に出すのはこれだけ）
  const terms = useMemo(() => project?.termPairs ?? [], [project]);
  // 実効対訳表（参照グローバルセット＋固有をマージ。各スキャン・翻訳の参照元）
  const effTerms = useMemo(() => (project ? effectiveTermPairs(project) : []), [project, allSets]);
  const referencedSets = useMemo(
    () => (project ? getReferencedTermSets(project) : []),
    [project, allSets],
  );

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
  // 参照グローバル対訳表の語も対象にする（effTerms）
  const variantHits: VariantHit[] = useMemo(() => {
    const out: VariantHit[] = [];
    for (const t of effTerms) {
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
  }, [effTerms, flatSections]);

  // 対訳表の波及: 原文に原語があるのに訳文に確定訳語が無い翻訳済みセグメント
  // 参照グローバル対訳表の語も対象にする（effTerms）
  const termMismatches = useMemo(() => {
    const out: { term: TermPair; sections: ReplacePreview[] }[] = [];
    for (const t of effTerms) {
      if (t.status !== "confirmed" || !t.source.trim() || !t.target.trim()) continue;
      const src = t.source.toLowerCase();
      const sections: ReplacePreview[] = [];
      for (const s of flatSections) {
        if (!s.body || !s.sourceText) continue;
        if (s.sourceText.toLowerCase().includes(src) && !s.body.includes(t.target)) {
          sections.push({
            chapterId: s.chapterId,
            sectionId: s.sectionId,
            chapterTitle: s.chapterTitle,
            sectionTitle: s.sectionTitle,
            count: countOccurrences(s.sourceText.toLowerCase(), src),
          });
        }
      }
      if (sections.length > 0) out.push({ term: t, sections });
    }
    return out;
  }, [effTerms, flatSections]);

  // 決定論的QAスキャン: 数値転記 / 段落数 / 文字数比率（AI不使用の即時チェック）
  const qaFindings: QaFinding[] = useMemo(() => {
    const sourceLang = project?.translationMeta?.sourceLang ?? "en";
    // 文字数比率（訳文/原文）の目安。外れたら訳抜け・水増しのシグナル
    const [ratioMin, ratioMax] = sourceLang === "en" ? [0.3, 1.15] : [0.9, 3.2];
    const out: QaFinding[] = [];
    for (const s of flatSections) {
      if (!s.sourceText || !s.body) continue;
      const issues: QaIssue[] = [];

      const bodyNorm = normalizeDigits(s.body);
      const missing = extractNumbers(s.sourceText).filter((n) => !bodyNorm.includes(n));
      if (missing.length > 0) {
        issues.push({
          kind: "number",
          message: `原文の数値が訳文に見つかりません: ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? " …" : ""}（漢数字・単位換算で表現している場合は問題ありません）`,
        });
      }

      const srcParas = countParagraphs(s.sourceText);
      const tgtParas = countParagraphs(s.body);
      if (Math.abs(srcParas - tgtParas) >= 2) {
        issues.push({
          kind: "paragraph",
          message: `段落数が原文 ${srcParas} に対し訳文 ${tgtParas}。段落の統合・分割か訳抜けの可能性`,
        });
      }

      const ratio = s.body.length / s.sourceText.length;
      if (ratio < ratioMin || ratio > ratioMax) {
        issues.push({
          kind: "ratio",
          message: `文字数比率 ${ratio.toFixed(2)}（訳文${s.body.length.toLocaleString()}字 / 原文${s.sourceText.length.toLocaleString()}字）が目安 ${ratioMin}〜${ratioMax} の範囲外。${ratio < ratioMin ? "訳抜け" : "加筆・水増し"}の可能性`,
        });
      }

      if (issues.length > 0) {
        out.push({
          chapterId: s.chapterId,
          sectionId: s.sectionId,
          chapterTitle: s.chapterTitle,
          sectionTitle: s.sectionTitle,
          issues,
        });
      }
    }
    return out;
  }, [flatSections, project]);

  const translatedCount = useMemo(
    () => flatSections.filter((s) => s.sourceText && s.body).length,
    [flatSections],
  );

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

  // ===== グローバル対訳表（セット）の参照・作成・取り込み =====

  function toggleSetRef(setId: string, on: boolean) {
    const ids = new Set(project?.termSetIds ?? []);
    if (on) ids.add(setId);
    else ids.delete(setId);
    setProject(setProjectTermSetIds([...ids]));
  }

  function handleSaveAsSet() {
    const confirmed = terms.filter((t) => t.status === "confirmed" && t.source.trim() && t.target.trim());
    if (confirmed.length === 0) {
      setError("グローバル保存できる確定済みの用語がありません。");
      return;
    }
    const name = window.prompt(
      "グローバル対訳表の名前を入力してください（他プロジェクトから参照できます）。",
      `${project?.name ?? "用語集"} の対訳表`,
    );
    if (name === null) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    const set = createTermSet(trimmed, confirmed);
    setAllSets(loadTermSets());
    // 作ったセットはこのプロジェクトからも参照状態にする
    setProject(setProjectTermSetIds([...(project?.termSetIds ?? []), set.id]));
    setInfo(`グローバル対訳表「${trimmed}」を作成しました（確定語 ${confirmed.length} 件）。`);
  }

  function handleDeleteSet(setId: string, name: string) {
    if (!confirm(`グローバル対訳表「${name}」を削除します。参照しているすべてのプロジェクトから外れます。よろしいですか？`)) {
      return;
    }
    deleteTermSet(setId);
    setAllSets(loadTermSets());
    setProject(loadProject());
    setInfo(`グローバル対訳表「${name}」を削除しました。`);
  }

  function handleCopySetIntoProject(set: TermSet) {
    const known = new Set(terms.map((t) => t.source.toLowerCase()));
    const fresh = set.terms
      .filter((t) => t.source.trim() && !known.has(t.source.toLowerCase()))
      .map((t) => ({ ...t, id: makeId("term") }));
    if (fresh.length === 0) {
      setInfo("取り込める新しい用語はありませんでした（すべて固有の対訳表に存在）。");
      return;
    }
    persistTerms([...terms, ...fresh]);
    setInfo(`「${set.name}」から ${fresh.length} 件をプロジェクト固有の対訳表に取り込みました。`);
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
        // 参照グローバルセットの語も「既知」として渡し、重複抽出を避ける
        existingTerms: effTerms.map((t) => ({ source: t.source, target: t.target })),
      });
      if (!r.ok) throw new Error(r.error ?? "用語抽出に失敗しました。");
      const incoming = r.data?.terms ?? [];
      const known = new Set(effTerms.map((t) => t.source.toLowerCase()));
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

  // ===== CSV 入出力 =====

  function handleExportCsv() {
    if (terms.length === 0) {
      setError("エクスポートする用語がありません。");
      return;
    }
    const header = "source,target,variants,notes,status";
    const rows = terms.map((t) =>
      [
        csvEscape(t.source),
        csvEscape(t.target),
        csvEscape((t.variants ?? []).join("|")),
        csvEscape(t.notes ?? ""),
        t.status,
      ].join(","),
    );
    // BOM付きUTF-8（Excelでの文字化け防止）
    const blob = new Blob(["﻿" + [header, ...rows].join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    saveAs(blob, `対訳表_${project?.name ?? "project"}.csv`);
  }

  async function handleImportCsv(file: File) {
    setError(null);
    setInfo(null);
    try {
      const text = await file.text();
      const rows = parseCsv(text.replace(/^﻿/, ""));
      if (rows.length === 0) throw new Error("CSVに行がありません。");
      // ヘッダ行（source,target,...）はスキップ
      const body = rows[0][0]?.trim().toLowerCase() === "source" ? rows.slice(1) : rows;
      const known = new Set(terms.map((t) => t.source.toLowerCase()));
      const imported: TermPair[] = [];
      for (const r of body) {
        const source = (r[0] ?? "").trim();
        const target = (r[1] ?? "").trim();
        if (!source || !target || known.has(source.toLowerCase())) continue;
        known.add(source.toLowerCase());
        imported.push({
          id: makeId("term"),
          source,
          target,
          variants: (r[2] ?? "")
            .split(/[|、]/)
            .map((v) => v.trim())
            .filter(Boolean),
          notes: (r[3] ?? "").trim() || undefined,
          status: (r[4] ?? "").trim() === "candidate" ? "candidate" : "confirmed",
        });
      }
      if (imported.length === 0) {
        setInfo("追加できる新しい用語はありませんでした（既存と重複、または空行）。");
        return;
      }
      persistTerms([...terms, ...imported]);
      setInfo(`CSVから ${imported.length} 語をインポートしました。`);
    } catch (e) {
      setError(`CSVの読み込みに失敗しました：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ===== 対訳表の波及: 確定訳語が未適用のセグメントを一括再翻訳 =====

  async function handleRetranslate(targets: ReplacePreview[], label: string) {
    if (!project || retermProgress !== null) return;
    if (
      !confirm(
        `${label}：${targets.length} セグメントを最新の対訳表で再翻訳します（1セグメントあたり数十秒。旧訳文は変更差分に退避されます）。開始しますか？`,
      )
    ) {
      return;
    }
    setError(null);
    retermCancelRef.current = false;
    let cur = project;
    const failures: string[] = [];
    try {
      for (let i = 0; i < targets.length; i++) {
        if (retermCancelRef.current) break;
        const t = targets[i];
        const chapter = cur.selectedOutline?.chapters.find((c) => c.id === t.chapterId);
        const section = chapter?.sections.find((s) => s.id === t.sectionId);
        if (!chapter || !section) continue;
        setRetermProgress(`${i + 1}/${targets.length}：${chapter.title} / ${section.title} を再翻訳中…`);
        try {
          cur = await generateSectionDraft(cur, chapter, section);
          setProject(cur);
        } catch (e) {
          failures.push(`${chapter.title}/${section.title}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      setInfo(
        `再翻訳が終了しました${retermCancelRef.current ? "（中断）" : ""}。` +
          (failures.length > 0 ? `失敗 ${failures.length} 件：${failures.join(" / ")}` : "失敗はありません。"),
      );
    } finally {
      setRetermProgress(null);
    }
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
          <button className="btn" onClick={handleExportCsv} type="button" title="対訳表をCSVで書き出す">
            CSV出力
          </button>
          <button
            className="btn"
            onClick={() => importFileRef.current?.click()}
            type="button"
            title="既存の用語集CSV（source,target,variants,notes,status）を取り込む"
          >
            CSVインポート
          </button>
          <input
            ref={importFileRef}
            type="file"
            accept=".csv,.tsv,.txt"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleImportCsv(f);
              e.target.value = "";
            }}
          />
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
      {retermProgress ? (
        <div className="alert info" style={{ marginBottom: 16 }}>
          <span className="spinner" /> {retermProgress}
          <button
            className="btn sm"
            type="button"
            style={{ marginLeft: 10 }}
            onClick={() => { retermCancelRef.current = true; }}
          >
            中断
          </button>
        </div>
      ) : null}

      <div className="panel">
        <div className="panel-header">
          <h2>グローバル対訳表（参照）</h2>
          <button className="btn sm" type="button" onClick={handleSaveAsSet} title="現在の確定語をグローバル対訳表として保存し、他プロジェクトから使い回す">
            確定語をグローバル保存
          </button>
        </div>
        <div className="panel-body dense">
          <p className="help" style={{ marginBottom: 10 }}>
            シリーズ物や分野の術語集を、プロジェクトをまたいで使い回せます。参照した対訳表の語は
            翻訳・用語統一・表記揺れ・適用チェックに反映されます（同じ原語はこのプロジェクト固有の語が優先）。
          </p>
          {allSets.length === 0 ? (
            <div className="empty-state">
              グローバル対訳表はまだありません。下の対訳表を整えて「確定語をグローバル保存」で作成できます。
            </div>
          ) : (
            <ul className="list-block">
              {allSets.map((s) => {
                const on = (project.termSetIds ?? []).includes(s.id);
                return (
                  <li key={s.id} className="flex" style={{ gap: 10, alignItems: "center" }}>
                    <label className="staff-toggle" style={{ flex: 1 }}>
                      <input type="checkbox" checked={on} onChange={(e) => toggleSetRef(s.id, e.target.checked)} />
                      <span>
                        <strong>{s.name}</strong>
                        <span className="muted" style={{ fontSize: 11, marginLeft: 8 }}>
                          {s.terms.length} 語{s.description ? ` — ${s.description}` : ""}
                        </span>
                      </span>
                    </label>
                    <button className="btn sm" type="button" onClick={() => handleCopySetIntoProject(s)} title="このセットの語をプロジェクト固有の対訳表に取り込む（編集可能になる）">
                      固有に取り込む
                    </button>
                    <button className="btn sm danger" type="button" onClick={() => handleDeleteSet(s.id, s.name)}>
                      削除
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {referencedSets.length > 0 ? (
            <p className="help" style={{ marginTop: 8 }}>
              参照中: {referencedSets.map((s) => s.name).join("、")}（実効対訳表 計 {effTerms.length} 語）。
              参照セットの語は下の編集表には出ません（読み取り専用）。
            </p>
          ) : null}
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h2>対訳表（このプロジェクト固有・{terms.length} 語{candidateCount > 0 ? ` / 候補 ${candidateCount}` : ""}）</h2>
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

      <div className="panel">
        <div className="panel-header">
          <h2>用語の適用チェック（対訳表の波及）</h2>
          <span className="hint">
            原文に原語があるのに、訳文に確定訳語が見当たらない翻訳済みセグメントを検出します
          </span>
        </div>
        <div className="panel-body dense">
          {terms.filter((t) => t.status === "confirmed").length === 0 ? (
            <div className="empty-state">
              確定済みの用語がありません。対訳表で訳語を「確定」すると、ここで適用漏れを検出できます。
            </div>
          ) : termMismatches.length === 0 ? (
            <div className="empty-state">
              すべての確定訳語が翻訳済みセグメントに適用されています。
            </div>
          ) : (
            <ul className="list-block">
              {termMismatches.map((m, i) => (
                <li key={i} className="flex" style={{ gap: 10, alignItems: "center" }}>
                  <span className="badge warn">{m.sections.length} セグメント</span>
                  <span style={{ flex: 1 }}>
                    <strong>{m.term.source} → {m.term.target}</strong> が適用されていない可能性
                    <span className="muted" style={{ display: "block", fontSize: 11 }}>
                      {m.sections.map((s) => `${s.chapterTitle}/${s.sectionTitle}`).join("、")}
                      ／意訳・言い換えの場合は問題ありません
                    </span>
                  </span>
                  <button
                    className="btn sm"
                    type="button"
                    disabled={retermProgress !== null}
                    onClick={() => handleRetranslate(m.sections, `「${m.term.source} → ${m.term.target}」の適用`)}
                  >
                    該当セグメントを再翻訳
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="help" style={{ marginTop: 8 }}>
            訳語を変更・確定したあとにここを確認すると、用語統一の運用が閉じます。
            再翻訳は最新の対訳表を使い、旧訳文は翻訳画面の「変更差分」に退避されます。
          </p>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h2>品質スキャン（QA）</h2>
          <span className="hint">
            数値転記・段落数・文字数比率をAIなしで即時チェック（翻訳済み {translatedCount} セグメント対象）
          </span>
        </div>
        <div className="panel-body dense">
          {translatedCount === 0 ? (
            <div className="empty-state">翻訳済みのセグメントがまだありません。</div>
          ) : qaFindings.length === 0 ? (
            <div className="empty-state">
              機械的チェックでは問題は検出されませんでした（数値の転記・段落数・文字数比率）。
            </div>
          ) : (
            <ul className="list-block">
              {qaFindings.map((f, i) => (
                <li key={i}>
                  <strong>{f.chapterTitle} / {f.sectionTitle}</strong>
                  <ul style={{ margin: "4px 0 0", paddingLeft: 0, listStyle: "none" }}>
                    {f.issues.map((issue, j) => (
                      <li key={j} className="flex" style={{ gap: 8, alignItems: "flex-start", marginTop: 4 }}>
                        <span className={`badge ${issue.kind === "number" ? "warn" : "gray"}`}>
                          {issue.kind === "number" ? "数値" : issue.kind === "paragraph" ? "段落" : "分量"}
                        </span>
                        <span className="muted" style={{ fontSize: 12 }}>{issue.message}</span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
          <p className="help" style={{ marginTop: 8 }}>
            ここはあくまで機械的なシグナルです。漢数字化・単位換算・段落の意図的な統合は誤検出になります。
            疑わしいセグメントは翻訳画面の対訳ビューで原文と突き合わせ、必要なら「再翻訳」してください。
          </p>
        </div>
      </div>
    </>
  );
}
