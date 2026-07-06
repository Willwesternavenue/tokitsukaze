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

function bodyParagraphs(body: string): Paragraph[] {
  if (!body) return [para("（本文未生成）")];
  return body.split(/\n+/).filter(Boolean).map((line) => para(line));
}

function sectionParagraphs(draft: SectionDraft): Paragraph[] {
  const blocks: Paragraph[] = [];
  blocks.push(heading(draft.sectionTitle, HeadingLevel.HEADING_2));
  blocks.push(...bodyParagraphs(draft.body));
  blocks.push(spacer());
  blocks.push(...listBlock("編集メモ", draft.editorNotes));
  blocks.push(...listBlock("追加質問", draft.followUpQuestions));
  blocks.push(...listBlock("事実確認ポイント", draft.factCheckPoints));
  blocks.push(...listBlock("前後のつながりメモ", draft.continuityNotes));
  return blocks;
}

function fileSafe(name: string): string {
  return name.replace(/[\\\/:*?"<>|]/g, "_").trim() || "untitled";
}

async function downloadDoc(doc: Document, filename: string): Promise<void> {
  const blob = await Packer.toBlob(doc);
  saveAs(blob, filename);
}

export async function exportSectionDocx(project: Project, draft: SectionDraft): Promise<void> {
  const doc = new Document({
    creator: "アキカゼ出版AI",
    title: `${draft.chapterTitle} / ${draft.sectionTitle}`,
    sections: [
      {
        properties: {},
        children: [
          heading(project.name, HeadingLevel.TITLE),
          para(`取材対象者：${project.intervieweeName}`),
          spacer(),
          heading(draft.chapterTitle, HeadingLevel.HEADING_1),
          ...sectionParagraphs(draft),
        ],
      },
    ],
  });
  await downloadDoc(doc, `${fileSafe(draft.chapterTitle)}_${fileSafe(draft.sectionTitle)}.docx`);
}

export async function exportProjectDocx(project: Project): Promise<void> {
  const children: Paragraph[] = [];
  children.push(heading(project.name, HeadingLevel.TITLE));
  children.push(para(`取材対象者：${project.intervieweeName}`));
  children.push(para(`テーマ：${project.theme}`));
  children.push(para(`想定読者：${project.targetReader}`));
  children.push(spacer());

  const outline = project.selectedOutline;
  if (!outline) {
    children.push(para("（構成案が未選択です。原稿生成画面で構成案を選んでください。）"));
  } else {
    children.push(heading(`構成：${outline.title}`, HeadingLevel.HEADING_1));
    children.push(para(outline.concept));
    children.push(spacer());

    for (const chapter of outline.chapters) {
      children.push(heading(`第${chapter.chapterNumber}章　${chapter.title}`, HeadingLevel.HEADING_1));
      if (chapter.summary) children.push(para(chapter.summary));
      children.push(spacer());

      for (const section of chapter.sections) {
        const draft = project.generatedSections.find(
          (d) => d.chapterId === chapter.id && d.sectionId === section.id,
        );
        if (draft) {
          children.push(...sectionParagraphs(draft));
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
