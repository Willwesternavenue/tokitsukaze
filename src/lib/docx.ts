"use client";

import {
  Document,
  FootnoteReferenceRun,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";
import { saveAs } from "file-saver";
import type { Project, Reference, SectionDraft } from "./types";
import {
  applyInTextCitations,
  authorYearMarker,
  buildBibliography,
  DEFAULT_CITATION_STYLE,
  formatNoteEntry,
  isFootnoteStyle,
} from "./citation";
import { getGenreConfig } from "./genreConfig";

function heading(text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel]): Paragraph {
  return new Paragraph({ text, heading: level });
}

function para(text: string, opts: { bold?: boolean } = {}): Paragraph {
  return new Paragraph({ children: [new TextRun({ text, bold: opts.bold })] });
}

function spacer(): Paragraph {
  return new Paragraph({ children: [new TextRun("")] });
}

// 参考文献リストの1行。学術文献リスト標準のぶら下げインデント（2行目以降を字下げして
// 番号/著者の頭を揃える）＋行間を少し詰める。単位は twip（480≒0.33インチ）。
function bibliographyParagraph(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text })],
    indent: { left: 480, hanging: 480 },
    spacing: { after: 80 },
  });
}

function listBlock(title: string, items: string[]): Paragraph[] {
  if (!items || items.length === 0) return [];
  const out: Paragraph[] = [para(title, { bold: true })];
  items.forEach((i) => out.push(new Paragraph({ text: `・${i}` })));
  out.push(spacer());
  return out;
}

/**
 * インラインMarkdown（**太字** / *斜体* / `コード`）を TextRun[] に変換する。
 * AI本文にはMarkdown記法が混ざるため、Word出力では記号を出さず書式にする。
 */
/**
 * 脚注コレクタ。1回の Word 出力を通して脚注 id を連番採番し、entries を貯める。
 * entries は Document({ footnotes }) にそのまま渡せる形（{ [id]: { children: Paragraph[] } }）。
 */
type FootnoteCtx = {
  refs: Reference[];
  nextId: number;
  entries: Record<number, { children: Paragraph[] }>;
  alloc(ref: Reference): number;
};

function createFootnoteCtx(refs: Reference[]): FootnoteCtx {
  const ctx: FootnoteCtx = {
    refs,
    nextId: 1,
    entries: {},
    alloc(ref: Reference) {
      const id = ctx.nextId++;
      ctx.entries[id] = {
        children: [new Paragraph({ children: [new TextRun(formatNoteEntry(ref))] })],
      };
      return id;
    },
  };
  return ctx;
}

/**
 * 行内テキストを、引用マーカー〔著者, 年〕の位置で分割して Word runs にする。
 * マーカー一致箇所は FootnoteReferenceRun（本文には上付き番号だけ残る）、
 * 非マーカー区間は既存 renderInline に委譲する（毎回フル注＝出現ごとに新 id）。
 */
function renderInlineWithFootnotes(
  text: string,
  ctx: FootnoteCtx,
): (TextRun | FootnoteReferenceRun)[] {
  // 長いマーカー優先（部分被り回避）。空マーカーは除外。
  const markers = ctx.refs
    .map((ref) => ({ ref, marker: authorYearMarker(ref) }))
    .filter((m) => m.marker.length > 0)
    .sort((a, b) => b.marker.length - a.marker.length);
  const out: (TextRun | FootnoteReferenceRun)[] = [];
  let i = 0;
  while (i < text.length) {
    let hit: { ref: Reference; marker: string } | null = null;
    for (const m of markers) {
      if (text.startsWith(m.marker, i)) {
        hit = m;
        break;
      }
    }
    if (hit) {
      out.push(new FootnoteReferenceRun(ctx.alloc(hit.ref)));
      i += hit.marker.length;
      continue;
    }
    // 次のマーカー開始位置まで素のテキスト。無ければ残り全部。
    let next = text.length;
    for (const m of markers) {
      const idx = text.indexOf(m.marker, i);
      if (idx !== -1 && idx < next) next = idx;
    }
    const seg = text.slice(i, next);
    if (seg) out.push(...renderInline(seg));
    i = next;
  }
  return out;
}

function renderInline(text: string): TextRun[] {
  const runs: TextRun[] = [];
  const re = /(\*\*([^*]+)\*\*|`([^`]+)`|\*([^*\s][^*]*?)\*|__([^_]+)__)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) runs.push(new TextRun(text.slice(last, m.index)));
    if (m[2] !== undefined) runs.push(new TextRun({ text: m[2], bold: true }));
    else if (m[3] !== undefined) runs.push(new TextRun({ text: m[3] })); // `code` は記号だけ外す
    else if (m[4] !== undefined) runs.push(new TextRun({ text: m[4], italics: true }));
    else if (m[5] !== undefined) runs.push(new TextRun({ text: m[5], bold: true }));
    last = re.lastIndex;
  }
  if (last < text.length) runs.push(new TextRun(text.slice(last)));
  return runs.length ? runs : [new TextRun(text)];
}

/** 見出し・番号記号を落として比較用に正規化する */
function normHeading(s: string): string {
  return s
    .replace(/^#+\s*/, "")
    .replace(/^[0-9０-９]+(\.[0-9０-９]+)*\s*[.　\s]*/, "") // 1.2 / 2.5.1 等の番号
    .replace(/[\s　]+/g, "")
    .trim();
}

/**
 * 本文冒頭に節タイトルと同じ見出しが重複している場合、その1行を取り除く。
 * （アプリが節見出しを付けるのに、AIが本文冒頭にも見出し＋番号を書くための二重化対策）
 */
function stripLeadingDuplicateHeading(body: string, sectionTitle: string): string {
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const titleNorm = normHeading(sectionTitle);
  if (!titleNorm) return body;
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  if (i >= lines.length) return body;
  const first = lines[i].trim();
  const isHeadingLike =
    /^#{1,6}\s+/.test(first) || /^[0-9０-９]+(\.[0-9０-９]+)*[.　\s]/.test(first);
  if (!isHeadingLike) return body;
  const firstNorm = normHeading(first);
  // タイトルと一致 or どちらかが他方を含む（番号付き重複を吸収）
  if (firstNorm === titleNorm || firstNorm.includes(titleNorm) || titleNorm.includes(firstNorm)) {
    lines.splice(i, 1);
    return lines.join("\n");
  }
  return body;
}

/** Markdownの区切り行（|---|---| 等）か判定 */
function isTableSeparator(line: string): boolean {
  const t = line.trim();
  return /-/.test(t) && /^\|?[\s:|-]+\|?$/.test(t) && t.replace(/[^|]/g, "").length >= 1;
}

/** `| a | b |` 行をセル配列に分解 */
function splitTableRow(line: string): string[] {
  let t = line.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|")) t = t.slice(0, -1);
  return t.split("|").map((c) => c.trim());
}

function buildTable(rows: string[][]): Table {
  const cols = Math.max(...rows.map((r) => r.length));
  const tableWidth = 9026; // DXA ≒ 6.27"
  const colW = Array.from({ length: cols }, (_, i) =>
    i === 0 ? tableWidth - Math.floor(tableWidth / cols) * (cols - 1) : Math.floor(tableWidth / cols),
  );
  const trs = rows.map((cells, ri) =>
    new TableRow({
      children: Array.from({ length: cols }, (_, ci) => {
        const text = cells[ci] ?? "";
        return new TableCell({
          width: { size: colW[ci], type: WidthType.DXA },
          verticalAlign: VerticalAlign.CENTER,
          children: [
            new Paragraph({
              children:
                ri === 0
                  ? [new TextRun({ text: text.replace(/\*\*/g, ""), bold: true })]
                  : renderInline(text),
            }),
          ],
        });
      }),
    }),
  );
  return new Table({
    columnWidths: colW,
    width: { size: tableWidth, type: WidthType.DXA },
    rows: trs,
  });
}

/**
 * 本文（Markdownが混ざり得る）を Word 要素に変換する。
 * 見出し(#)・箇条書き(-)・**太字**・表(|…|) を書式化し、記号を残さない。
 */
function bodyParagraphs(
  body: string,
  transform?: (t: string) => string,
  footnoteCtx?: FootnoteCtx,
): (Paragraph | Table)[] {
  if (!body) return [para("（本文未生成）")];
  const out: (Paragraph | Table)[] = [];
  // 脚注モードは文字列変換を通さず（本文にマーカーを残す代わりに脚注参照へ退避）、
  // 行内を renderInlineWithFootnotes で処理する。非脚注時は従来どおり transform を当てる。
  const src = footnoteCtx ? body : transform ? transform(body) : body;
  const inline = (t: string): (TextRun | FootnoteReferenceRun)[] =>
    footnoteCtx ? renderInlineWithFootnotes(t, footnoteCtx) : renderInline(t);
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  for (let idx = 0; idx < lines.length; idx++) {
    const raw = lines[idx];
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) continue;
    if (/^```/.test(line) || /^(\s*([-*_])\s*){3,}$/.test(line.trim())) continue;

    // Markdown表: |ヘッダ| の次行が区切り行なら表としてまとめる
    if (/^\s*\|.*\|\s*$/.test(line) && idx + 1 < lines.length && isTableSeparator(lines[idx + 1])) {
      const rows: string[][] = [splitTableRow(line)];
      idx += 2; // ヘッダと区切りを消費
      while (idx < lines.length && /^\s*\|.*\|?\s*$/.test(lines[idx]) && lines[idx].includes("|")) {
        rows.push(splitTableRow(lines[idx]));
        idx++;
      }
      idx--; // forのidx++と相殺
      out.push(buildTable(rows));
      continue;
    }

    // 見出し: ### 2.5.2 タイトル → Word見出し（節はH2なので本文内はH3/H4）
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      out.push(
        new Paragraph({
          children: inline(h[2].trim()),
          heading: level <= 2 ? HeadingLevel.HEADING_3 : HeadingLevel.HEADING_4,
        }),
      );
      continue;
    }
    // 箇条書き: - / * / + → ・ 付き段落
    const b = line.match(/^\s*[-*+]\s+(.*)$/);
    if (b) {
      out.push(new Paragraph({ children: [new TextRun("・"), ...inline(b[1])] }));
      continue;
    }
    // 引用: > text → 記号を外す
    const q = line.match(/^\s*>\s?(.*)$/);
    if (q) {
      out.push(new Paragraph({ children: inline(q[1]) }));
      continue;
    }
    out.push(new Paragraph({ children: inline(line) }));
  }
  return out.length ? out : [para("")];
}

/**
 * 節の出力。既定は本文のみのクリーンな原稿。
 * includeNotes=true のときだけ編集メモ等の作業メモを付ける（校正用）。
 */
function sectionParagraphs(
  draft: SectionDraft,
  includeNotes = false,
  transformBody?: (t: string) => string,
  footnoteCtx?: FootnoteCtx,
): (Paragraph | Table)[] {
  const blocks: (Paragraph | Table)[] = [];
  blocks.push(heading(draft.sectionTitle, HeadingLevel.HEADING_2));
  // 本文冒頭にAIが付けた重複見出し（番号付き）を除去してから流す
  blocks.push(
    ...bodyParagraphs(
      stripLeadingDuplicateHeading(draft.body, draft.sectionTitle),
      transformBody,
      footnoteCtx,
    ),
  );
  blocks.push(spacer());
  if (includeNotes) {
    blocks.push(...listBlock("編集メモ", draft.editorNotes));
    blocks.push(...listBlock("追加質問", draft.followUpQuestions));
    blocks.push(...listBlock("事実確認ポイント", draft.factCheckPoints));
    blocks.push(...listBlock("前後のつながりメモ", draft.continuityNotes));
  }
  return blocks;
}

function fileSafe(name: string): string {
  return name.replace(/[\\\/:*?"<>|]/g, "_").trim() || "untitled";
}

async function downloadDoc(doc: Document, filename: string): Promise<void> {
  const blob = await Packer.toBlob(doc);
  saveAs(blob, filename);
}

export async function exportSectionDocx(
  project: Project,
  draft: SectionDraft,
  includeNotes = false,
): Promise<void> {
  const subjectLabel = getGenreConfig(project.genre).material.subjectLabel;
  const front: (Paragraph | Table)[] = [heading(project.name, HeadingLevel.TITLE)];
  if (project.intervieweeName?.trim()) {
    front.push(para(`${subjectLabel}：${project.intervieweeName}`));
  }
  front.push(spacer());
  // 単一節でも脚注スタイルなら脚注を織り込む（断片扱いなので末尾の参考文献リストは付けない）。
  const isPaper = project.genre === "paper";
  const paperRefs = isPaper ? project.references ?? [] : [];
  const citationStyle = project.paperMeta?.citationStyle ?? DEFAULT_CITATION_STYLE;
  const footnoteMode = isPaper && paperRefs.length > 0 && isFootnoteStyle(citationStyle);
  const footnoteCtx = footnoteMode ? createFootnoteCtx(paperRefs) : undefined;
  const doc = new Document({
    creator: "アキカゼ出版AI",
    title: `${draft.chapterTitle} / ${draft.sectionTitle}`,
    ...(footnoteCtx ? { footnotes: footnoteCtx.entries } : {}),
    sections: [
      {
        properties: {},
        children: [
          ...front,
          heading(draft.chapterTitle, HeadingLevel.HEADING_1),
          ...sectionParagraphs(draft, includeNotes, undefined, footnoteCtx),
        ],
      },
    ],
  });
  await downloadDoc(doc, `${fileSafe(draft.chapterTitle)}_${fileSafe(draft.sectionTitle)}.docx`);
}

export async function exportProjectDocx(project: Project, includeNotes = false): Promise<void> {
  // クリーンな原稿として出力する（作業メモ・内部メタは既定で出さない）
  const isPaper = project.genre === "paper";
  const subjectLabel = getGenreConfig(project.genre).material.subjectLabel;
  const children: (Paragraph | Table)[] = [];
  children.push(heading(project.name, HeadingLevel.TITLE));
  if (project.intervieweeName?.trim()) {
    children.push(para(`${subjectLabel}：${project.intervieweeName}`));
  }
  children.push(spacer());

  // 論文モード: タイトル/著者の下に要旨・キーワードを出す
  if (isPaper && project.paperMeta?.abstract?.trim()) {
    children.push(heading("要旨", HeadingLevel.HEADING_1));
    children.push(...bodyParagraphs(project.paperMeta.abstract));
    if (project.paperMeta.keywords?.trim()) {
      children.push(para(`キーワード：${project.paperMeta.keywords}`));
    }
    children.push(spacer());
  }

  // 論文モード: 引用スタイルに応じて本文マーカーを変換し、末尾に参考文献リストを付ける。
  // 番号式は全本文の連結を出現順の採番に使うため、先に全文を集める。
  const paperRefs = isPaper ? project.references ?? [] : [];
  const citationStyle = project.paperMeta?.citationStyle ?? DEFAULT_CITATION_STYLE;
  const allBodyText = isPaper
    ? project.generatedSections.map((d) => d.body).filter(Boolean).join("\n")
    : "";
  const footnoteMode = isPaper && paperRefs.length > 0 && isFootnoteStyle(citationStyle);
  const footnoteCtx = footnoteMode ? createFootnoteCtx(paperRefs) : undefined;
  const transformBody =
    isPaper && paperRefs.length > 0 && !footnoteMode
      ? (t: string) => applyInTextCitations(t, paperRefs, citationStyle, allBodyText)
      : undefined;

  const outline = project.selectedOutline;
  if (!outline) {
    children.push(para("（構成案が未選択です。原稿生成画面で構成案を選んでください。）"));
  } else {
    for (const chapter of outline.chapters) {
      // 論文は「第N章」を付けず章タイトルのみ。他ジャンルは従来どおり
      children.push(
        heading(
          isPaper ? chapter.title : `第${chapter.chapterNumber}章　${chapter.title}`,
          HeadingLevel.HEADING_1,
        ),
      );
      // 章概要は内部メタ（論文の【役割:…】タグ等）なので原稿には出さない
      children.push(spacer());

      for (const section of chapter.sections) {
        const draft = project.generatedSections.find(
          (d) => d.chapterId === chapter.id && d.sectionId === section.id,
        );
        if (draft) {
          children.push(...sectionParagraphs(draft, includeNotes, transformBody, footnoteCtx));
        } else {
          children.push(heading(section.title, HeadingLevel.HEADING_2));
          children.push(para("（本文未生成）"));
          children.push(spacer());
        }
      }
    }
  }

  // 論文モード: 参考文献リスト（登録文献から決定論的に整形。ぶら下げインデントで体裁を揃える）
  if (isPaper && paperRefs.length > 0) {
    children.push(heading("参考文献", HeadingLevel.HEADING_1));
    const entries = buildBibliography(paperRefs, citationStyle, allBodyText);
    for (const entry of entries) {
      children.push(bibliographyParagraph(entry));
    }
    children.push(spacer());
  }

  const doc = new Document({
    creator: "アキカゼ出版AI",
    title: project.name,
    ...(footnoteCtx ? { footnotes: footnoteCtx.entries } : {}),
    sections: [{ properties: {}, children }],
  });
  await downloadDoc(doc, `アキカゼ出版AI_全体原稿ドラフト_${fileSafe(project.name)}.docx`);
}

// ===== 翻訳書モード: 対訳（原文・訳文の2列テーブル）Word出力 =====

function cellParagraphs(text: string, muted = false): Paragraph[] {
  const lines = (text || "").split(/\n+/).filter(Boolean);
  if (lines.length === 0) return [new Paragraph({ children: [new TextRun("")] })];
  return lines.map(
    (line) =>
      new Paragraph({
        children: [new TextRun({ text: line, color: muted ? "666666" : undefined, size: 20 })],
      }),
  );
}

function bilingualRow(source: string, target: string): TableRow {
  return new TableRow({
    children: [
      new TableCell({
        width: { size: 50, type: WidthType.PERCENTAGE },
        verticalAlign: VerticalAlign.TOP,
        children: cellParagraphs(source, true),
      }),
      new TableCell({
        width: { size: 50, type: WidthType.PERCENTAGE },
        verticalAlign: VerticalAlign.TOP,
        children: cellParagraphs(target),
      }),
    ],
  });
}

/**
 * 対訳Word出力: 章ごとに「原文｜訳文」の2列テーブルを並べる。
 * 未翻訳セグメントは訳文側に（未翻訳）と出す。校正・突き合わせ確認用。
 */
export async function exportBilingualDocx(project: Project): Promise<void> {
  const outline = project.selectedOutline;
  if (!outline) throw new Error("構成（章・セグメント）がありません。先に原文を取り込んでください。");

  const children: (Paragraph | Table)[] = [];
  children.push(heading(project.name, HeadingLevel.TITLE));
  children.push(para(`原著者：${project.intervieweeName}`));
  children.push(para("対訳ドラフト（左：原文 / 右：訳文）"));
  children.push(spacer());

  for (const chapter of outline.chapters) {
    children.push(heading(chapter.title, HeadingLevel.HEADING_1));
    const rows: TableRow[] = [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 50, type: WidthType.PERCENTAGE },
            children: [para("原文", { bold: true })],
          }),
          new TableCell({
            width: { size: 50, type: WidthType.PERCENTAGE },
            children: [para("訳文", { bold: true })],
          }),
        ],
      }),
    ];
    for (const section of chapter.sections) {
      const draft = project.generatedSections.find(
        (d) => d.chapterId === chapter.id && d.sectionId === section.id,
      );
      rows.push(bilingualRow(section.sourceText ?? "（原文なし）", draft?.body ?? "（未翻訳）"));
    }
    children.push(new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }));
    children.push(spacer());
  }

  const doc = new Document({
    creator: "アキカゼ出版AI",
    title: `${project.name}（対訳）`,
    sections: [{ properties: {}, children }],
  });
  await downloadDoc(doc, `対訳_${fileSafe(project.name)}.docx`);
}

// ===== 論文モード: 予稿（短縮版）Word 出力 =====

/**
 * 予稿（4〜8p の短縮版）を Word で出力する。
 * タイトル・著者・要旨・キーワードに続けて、preprint（Markdown本文）を整形して出す。
 */
export async function exportPreprintDocx(project: Project): Promise<void> {
  const preprint = project.paperMeta?.preprint?.trim();
  if (!preprint) throw new Error("予稿がありません。先に「予稿を生成」してください。");
  const subjectLabel = getGenreConfig(project.genre).material.subjectLabel;
  const children: (Paragraph | Table)[] = [heading(project.name, HeadingLevel.TITLE)];
  children.push(para(`${subjectLabel}：${project.intervieweeName || ""}（予稿）`));
  children.push(spacer());
  if (project.paperMeta?.abstract?.trim()) {
    children.push(heading("要旨", HeadingLevel.HEADING_1));
    children.push(...bodyParagraphs(project.paperMeta.abstract));
    if (project.paperMeta.keywords?.trim()) {
      children.push(para(`キーワード：${project.paperMeta.keywords}`));
    }
    children.push(spacer());
  }
  // 引用スタイルの本文マーカー変換＋末尾の参考文献リスト（本編 exportProjectDocx と体裁を揃える）。
  // 番号式の採番は予稿本文そのものを出現順の基準にする。
  const paperRefs = project.references ?? [];
  const citationStyle = project.paperMeta?.citationStyle ?? DEFAULT_CITATION_STYLE;
  const footnoteMode = paperRefs.length > 0 && isFootnoteStyle(citationStyle);
  const footnoteCtx = footnoteMode ? createFootnoteCtx(paperRefs) : undefined;
  const transformBody =
    paperRefs.length > 0 && !footnoteMode
      ? (t: string) => applyInTextCitations(t, paperRefs, citationStyle, preprint)
      : undefined;
  children.push(...bodyParagraphs(preprint, transformBody, footnoteCtx));

  if (paperRefs.length > 0) {
    children.push(spacer());
    children.push(heading("参考文献", HeadingLevel.HEADING_1));
    for (const entry of buildBibliography(paperRefs, citationStyle, preprint)) {
      children.push(bibliographyParagraph(entry));
    }
  }

  const doc = new Document({
    creator: "アキカゼ出版AI",
    title: `${project.name}（予稿）`,
    ...(footnoteCtx ? { footnotes: footnoteCtx.entries } : {}),
    sections: [{ properties: {}, children }],
  });
  await downloadDoc(doc, `予稿_${fileSafe(project.name)}.docx`);
}
