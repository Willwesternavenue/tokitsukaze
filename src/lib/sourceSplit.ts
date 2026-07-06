import type { Chapter, OutlineProposal, Section } from "./types";
import { makeId } from "./ids";

/**
 * 翻訳書モード: 原文テキストを章・セグメントに分割する（クライアント側・決定論的）。
 *
 * 方針:
 *  - 章見出し（第N章 / Chapter N / PART N / プロローグ等）の行で章に分割
 *  - 見出しが見つからない（1章になってしまう）場合は、文字数ベースで章を切る
 *  - 各章は段落境界を保ちながら targetChars 前後のセグメントに分割し、
 *    セグメントの原文を Section.sourceText に持たせる
 *  - AIは使わない（原文の構造は原文が知っている）
 */

export type SourceChapter = {
  title: string;
  text: string;
};

const CHAPTER_HEADING_RE =
  /^\s*(第\s*[0-9０-９一二三四五六七八九十百]+\s*[章部話]|Chapter\s+[0-9IVXLC]+|CHAPTER\s+[0-9IVXLC]+|PART\s+[0-9IVXLC]+|Part\s+[0-9IVXLC]+|Prologue|Epilogue|Introduction|Conclusion|Appendix(\s+[A-Z0-9]+)?|プロローグ|エピローグ|序章|終章|序文|はじめに|おわりに|あとがき|訳者あとがき)\b.*$/;

/** 原文テキストを章に分割する */
export function splitIntoChapters(text: string): SourceChapter[] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/ /g, " ");
  const lines = normalized.split("\n");

  const chapters: SourceChapter[] = [];
  let currentTitle = "";
  let buf: string[] = [];

  const flush = () => {
    const body = buf.join("\n").trim();
    if (body || currentTitle) {
      chapters.push({ title: currentTitle || "（前付け）", text: body });
    }
    buf = [];
  };

  for (const line of lines) {
    if (CHAPTER_HEADING_RE.test(line.trim()) && line.trim().length <= 80) {
      flush();
      currentTitle = line.trim();
    } else {
      buf.push(line);
    }
  }
  flush();

  // 見出しで2章以上に割れたら本文のある章だけ返す
  const withBody = chapters.filter((c) => c.text.trim().length > 0);
  if (withBody.length >= 2) return withBody;

  // 見出しが見つからない場合: 文字数ベースで章を切る（約8,000字・段落境界）
  const whole = normalized.trim();
  if (!whole) return [];
  const chunks = splitByParagraph(whole, 8000);
  if (chunks.length === 1) return [{ title: "本文", text: chunks[0] }];
  return chunks.map((t, i) => ({ title: `パート ${i + 1}`, text: t }));
}

/** 段落境界を保ちながら targetChars 前後のかたまりに分割する */
export function splitByParagraph(text: string, targetChars: number): string[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (paragraphs.length === 0) return [];

  const out: string[] = [];
  let buf: string[] = [];
  let size = 0;
  for (const p of paragraphs) {
    // 単一段落が上限の1.5倍を超える場合はそのまま1セグメントにする（文中では切らない）
    if (size > 0 && size + p.length > targetChars) {
      out.push(buf.join("\n\n"));
      buf = [];
      size = 0;
    }
    buf.push(p);
    size += p.length;
    if (size >= targetChars * 1.5) {
      out.push(buf.join("\n\n"));
      buf = [];
      size = 0;
    }
  }
  if (buf.length > 0) out.push(buf.join("\n\n"));
  return out;
}

/** セグメントの一覧タイトル用に原文の冒頭を短く抜粋する */
function excerpt(text: string, max = 24): string {
  const head = text.replace(/\s+/g, " ").trim().slice(0, max);
  return head + (text.length > max ? "…" : "");
}

/**
 * 章分割の結果から、翻訳用の OutlineProposal を組み立てる。
 * 各セグメントが Section になり、原文を sourceText に保持する。
 */
export function buildTranslationOutline(
  chapters: SourceChapter[],
  segmentChars = 2000,
): OutlineProposal {
  const outChapters: Chapter[] = chapters.map((c, ci) => {
    const segs = splitByParagraph(c.text, segmentChars);
    const sections: Section[] = segs.map((t, si) => ({
      id: `section-${makeId("seg")}`,
      title: `${si + 1}. ${excerpt(t)}`,
      summary: `原文 ${t.length.toLocaleString()} 字のセグメント`,
      sourceText: t,
    }));
    return {
      id: `chapter-${makeId("ch")}`,
      chapterNumber: ci + 1,
      title: c.title,
      summary: `原文 ${c.text.length.toLocaleString()} 字 / ${sections.length} セグメント`,
      sections,
    };
  });

  return {
    id: `outline-${makeId("tr")}`,
    title: "原文の章構成",
    type: "chronological",
    concept: "原文の構造をそのまま章・セグメントに分割した構成です。",
    recommendedFor: "翻訳書モード",
    chapters: outChapters,
  };
}

/** /outline 画面表示用に sourceText を落とした軽量コピーを作る（localStorage節約） */
export function stripSourceText(outline: OutlineProposal): OutlineProposal {
  return {
    ...outline,
    chapters: outline.chapters.map((c) => ({
      ...c,
      sections: c.sections.map(({ sourceText: _sourceText, ...rest }) => rest),
    })),
  };
}
