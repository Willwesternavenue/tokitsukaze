// 引用スタイルと参考文献リストのフォーマッタ（決定論的・AI不使用）。
//
// 設計方針:
// - 生成時は全スタイル共通で本文に「著者・年マーカー」〔著者, 年〕を書かせる（引用安全ルールと
//   citation-check の突合が形式に依存せず成立する）。マーカー文字列は authorYearMarker() が
//   参考文献レコードから一意に決まるので、番号式への変換は「厳密な文字列一致の置換」で安全に行える。
// - 番号式（IEEE）は AI に採番させず、export 時に「本文中の出現順（未引用は登録順で後置）」で
//   決定論的に採番する。番号がブレる問題を根絶するため（HANDOFF の設計判断）。
// - 文献一覧の各行はスタイル別に整形する。
//
// このモジュールは client（docx.ts）と workflow step（draft.ts）双方から import されるため、
// "use client" を付けず、Reference 型以外に依存しない純粋関数だけを置く。

import type { Reference } from "./types";

export type CitationStyle = "apa" | "ieee" | "sist02" | "mla";

export const DEFAULT_CITATION_STYLE: CitationStyle = "apa";

export const CITATION_STYLE_OPTIONS: {
  value: CitationStyle;
  label: string;
  help: string;
}[] = [
  {
    value: "apa",
    label: "APA（著者・年）",
    help: "本文: 〔著者, 年〕／一覧: 著者名順。教育学・人文社会・心理系",
  },
  {
    value: "ieee",
    label: "IEEE（番号 [1]）",
    help: "本文: [1]（出現順に自動採番）／一覧: 番号順。AI・情報・工学系",
  },
  {
    value: "sist02",
    label: "SIST 02・和文誌",
    help: "本文: 〔著者, 年〕／一覧: 著者名「表題」誌名. 巻(号), 頁 (年). 和文紀要・学会誌",
  },
  {
    value: "mla",
    label: "MLA（著者）",
    help: "本文: 〔著者〕／一覧: 著者名順（Works Cited）。文学・言語・人文系",
  },
];

export function citationStyleLabel(style: CitationStyle | undefined): string {
  const s = style ?? DEFAULT_CITATION_STYLE;
  return CITATION_STYLE_OPTIONS.find((o) => o.value === s)?.label ?? "APA（著者・年）";
}

/** 番号式（本文マーカーが [n]）かどうか */
export function isNumericStyle(style: CitationStyle): boolean {
  return style === "ieee";
}

/** 著者の姓（あるいは最初の著者名）を短く。マーカー用 */
function shortAuthor(ref: Reference): string {
  const a = (ref.author ?? "").trim();
  if (a) {
    // 「山田太郎ほか」「Smith et al.」等はそのまま。複数著者はカンマ/・/&/and で最初だけ拾う
    const first = a.split(/[,、;；・&]| and /)[0].trim();
    return first || a;
  }
  return ref.title.trim();
}

/**
 * 生成時に本文へ書かせる著者・年マーカー。全スタイル共通の「正準形」。
 * 参考文献レコードから一意に決まるため、後段の置換キーとして使える。
 */
export function authorYearMarker(ref: Reference): string {
  const author = shortAuthor(ref);
  const year = (ref.year ?? "").trim();
  return year ? `〔${author}, ${year}〕` : `〔${author}〕`;
}

/** MLA 本文マーカー（年を落とす）。〔著者〕 */
function mlaMarker(ref: Reference): string {
  return `〔${shortAuthor(ref)}〕`;
}

/**
 * 文献の順序と（番号式なら）採番を決める。
 * - 番号式: bodyText 中の authorYearMarker 出現順。未引用は登録順で後置。number は 1 始まり。
 * - 著者年式: 著者名（なければ表題）の昇順。number は付かない（0）。
 */
export function orderReferences(
  refs: Reference[],
  style: CitationStyle,
  bodyText = "",
): { ref: Reference; number: number }[] {
  if (isNumericStyle(style)) {
    const firstIndexOf = (r: Reference): number => {
      const idx = bodyText.indexOf(authorYearMarker(r));
      return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
    };
    const ordered = [...refs].sort((a, b) => {
      const ia = firstIndexOf(a);
      const ib = firstIndexOf(b);
      if (ia !== ib) return ia - ib;
      // 双方未引用（or 同位置）は登録順を維持
      return refs.indexOf(a) - refs.indexOf(b);
    });
    return ordered.map((ref, i) => ({ ref, number: i + 1 }));
  }
  const collator = new Intl.Collator("ja");
  const key = (r: Reference) => (r.author?.trim() || r.title.trim());
  const ordered = [...refs].sort((a, b) => collator.compare(key(a), key(b)));
  return ordered.map((ref) => ({ ref, number: 0 }));
}

/** スタイル別の文献一覧1行（先頭の番号/記号は呼び出し側で付与しない＝ここで完結） */
export function formatBibliographyEntry(
  ref: Reference,
  style: CitationStyle,
  number: number,
): string {
  const author = (ref.author ?? "").trim();
  const title = ref.title.trim();
  const source = (ref.source ?? "").trim();
  const year = (ref.year ?? "").trim();
  const url = (ref.url ?? "").trim();
  const join = (parts: (string | undefined)[], sep: string) =>
    parts.map((p) => (p ?? "").trim()).filter(Boolean).join(sep);

  switch (style) {
    case "ieee": {
      // [n] 著者, "表題," 誌名, 年. URL
      const body = join([author, title ? `“${title},”` : "", source, year], " ");
      const tail = url ? ` ${url}` : "";
      return `[${number}] ${body}.${tail}`;
    }
    case "sist02": {
      // 著者. 表題. 誌名. 年, URL.  （和文誌：表題は「」で括る）
      const body = join(
        [author ? `${author}.` : "", title ? `「${title}」` : "", source ? `${source}.` : "", year ? `${year}.` : ""],
        " ",
      );
      const tail = url ? ` ${url}` : "";
      return `${body}${tail}`.trim();
    }
    case "mla": {
      // 著者. "表題." 誌名, 年. URL.
      const body = join(
        [author ? `${author}.` : "", title ? `“${title}.”` : "", source ? `${source},` : "", year ? `${year}.` : ""],
        " ",
      );
      const tail = url ? ` ${url}.` : "";
      return `${body}${tail}`.trim();
    }
    case "apa":
    default: {
      // 著者 (年). 表題. 誌名. URL
      const head = join([author, year ? `(${year}).` : ""], " ");
      const body = join([head, title ? `${title}.` : "", source ? `${source}.` : ""], " ");
      const tail = url ? ` ${url}` : "";
      return `${body}${tail}`.trim();
    }
  }
}

/** 参考文献リスト全体を、表示順に整形した文字列配列で返す */
export function buildBibliography(
  refs: Reference[],
  style: CitationStyle,
  bodyText = "",
): string[] {
  const ordered = orderReferences(refs, style, bodyText);
  return ordered.map(({ ref, number }) => formatBibliographyEntry(ref, style, number));
}

/**
 * 本文中の著者・年マーカーをスタイルに合わせて置換する。
 * - IEEE: 〔著者, 年〕 → [n]（orderReferences の採番に一致）
 * - MLA: 〔著者, 年〕 → 〔著者〕（年を落とす）
 * - APA / SIST02: そのまま（本文は著者・年マーカー）
 * マッチしないマーカーは改変しない（データ欠損を避ける）。
 */
export function applyInTextCitations(
  body: string,
  refs: Reference[],
  style: CitationStyle,
  bodyTextForNumbering = body,
): string {
  if (!body) return body;
  if (style === "apa" || style === "sist02") return body;

  if (style === "mla") {
    let out = body;
    for (const ref of refs) {
      const marker = authorYearMarker(ref);
      const replacement = mlaMarker(ref);
      if (marker !== replacement) out = out.split(marker).join(replacement);
    }
    return out;
  }

  // ieee
  const ordered = orderReferences(refs, style, bodyTextForNumbering);
  let out = body;
  for (const { ref, number } of ordered) {
    const marker = authorYearMarker(ref);
    out = out.split(marker).join(`[${number}]`);
  }
  return out;
}

/**
 * 生成プロンプト（buildPaperContext）に載せる、スタイルごとの引用指示文。
 * 生成時は常に authorYearMarker を書かせ、最終形はスタイルで整えると伝える。
 */
export function citationInstruction(style: CitationStyle): string {
  const base =
    "- 本文で文献を引用するときは、上の各文献に付記した引用マーカー（〔著者, 年〕）をそのまま書くこと。マーカーは登録済み文献にあるものだけを使い、無い場合は架空文献を作らず〔要出典〕と書く";
  switch (style) {
    case "ieee":
      return (
        base +
        "\n- 最終的な体裁は IEEE（番号式 [1][2]…）。番号は出力後にシステムが出現順で自動採番するので、本文では番号ではなく〔著者, 年〕マーカーのまま書くこと"
      );
    case "mla":
      return (
        base +
        "\n- 最終的な体裁は MLA。文献一覧は Works Cited として著者名順に整形される（本文マーカーはシステムが整える）"
      );
    case "sist02":
      return (
        base +
        "\n- 最終的な体裁は SIST 02（和文誌）。文献一覧は「著者. 表題. 誌名. 年.」で整形される"
      );
    case "apa":
    default:
      return base + "\n- 体裁は APA（著者・年）。文献一覧は著者名順に整形される";
  }
}
