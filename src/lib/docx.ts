"use client";

import {
  Document,
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
import type { Project, SectionDraft } from "./types";
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

/**
 * 本文（Markdownが混ざり得る）を Word 段落に変換する。
 * 見出し(#)・箇条書き(-,*,+)・番号付き は書式化し、余分な記号を残さない。
 */
function bodyParagraphs(body: string): Paragraph[] {
  if (!body) return [para("（本文未生成）")];
  const out: Paragraph[] = [];
  for (const raw of body.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) continue;
    // コードフェンス・水平線は捨てる
    if (/^```/.test(line) || /^(\s*([-*_])\s*){3,}$/.test(line.trim())) continue;

    // 見出し: ### 2.5.2 タイトル → Word見出し（節はH2なので本文内はH3/H4）
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      out.push(
        new Paragraph({
          children: renderInline(h[2].trim()),
          heading: level <= 2 ? HeadingLevel.HEADING_3 : HeadingLevel.HEADING_4,
        }),
      );
      continue;
    }
    // 箇条書き: - / * / + → ・ 付き段落
    const b = line.match(/^\s*[-*+]\s+(.*)$/);
    if (b) {
      out.push(new Paragraph({ children: [new TextRun("・"), ...renderInline(b[1])] }));
      continue;
    }
    // 引用: > text → 記号を外す
    const q = line.match(/^\s*>\s?(.*)$/);
    if (q) {
      out.push(new Paragraph({ children: renderInline(q[1]) }));
      continue;
    }
    // 通常段落（番号付き "1." はそのままでOK）
    out.push(new Paragraph({ children: renderInline(line) }));
  }
  return out.length ? out : [para("")];
}

/**
 * 節の出力。既定は本文のみのクリーンな原稿。
 * includeNotes=true のときだけ編集メモ等の作業メモを付ける（校正用）。
 */
function sectionParagraphs(draft: SectionDraft, includeNotes = false): Paragraph[] {
  const blocks: Paragraph[] = [];
  blocks.push(heading(draft.sectionTitle, HeadingLevel.HEADING_2));
  blocks.push(...bodyParagraphs(draft.body));
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
  const front: Paragraph[] = [heading(project.name, HeadingLevel.TITLE)];
  if (project.intervieweeName?.trim()) {
    front.push(para(`${subjectLabel}：${project.intervieweeName}`));
  }
  front.push(spacer());
  const doc = new Document({
    creator: "アキカゼ出版AI",
    title: `${draft.chapterTitle} / ${draft.sectionTitle}`,
    sections: [
      {
        properties: {},
        children: [
          ...front,
          heading(draft.chapterTitle, HeadingLevel.HEADING_1),
          ...sectionParagraphs(draft, includeNotes),
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
  const children: Paragraph[] = [];
  children.push(heading(project.name, HeadingLevel.TITLE));
  if (project.intervieweeName?.trim()) {
    children.push(para(`${subjectLabel}：${project.intervieweeName}`));
  }
  children.push(spacer());

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
          children.push(...sectionParagraphs(draft, includeNotes));
        } else {
          children.push(heading(section.title, HeadingLevel.HEADING_2));
          children.push(para("（本文未生成）"));
          children.push(spacer());
        }
      }
    }
  }

  const doc = new Document({
    creator: "アキカゼ出版AI",
    title: project.name,
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
