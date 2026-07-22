# PR-B3: 和文脚注モード（本文＝上付き番号 / ページ下部＝脚注） — 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 行番号ではなく本文中の文字列をアンカーに置換すること。

**Goal:** 論文モードに引用体裁「和文脚注」を1つ追加し、選ぶと Word 出力時に本文中のマーカー〔著者, 年〕が上付き番号になり、ページ下部に脚注（docx footnotes）＋末尾に参考文献リストが出るようにする。

**Architecture:** `CitationStyle` に値 `"jp-footnote"` を1つ足す（方式A）。本文のマーカーは従来どおり `authorYearMarker` 正準形のまま保存し、脚注化は Word 出力時のみ。`citation.ts` に純粋関数 `isFootnoteStyle`/`formatNoteEntry` を足し、`docx.ts` に「脚注コレクタ（`FootnoteCtx`）＋本文レンダ中に `FootnoteReferenceRun` を織り込む `renderInlineWithFootnotes`」を足して、論文3経路（本編・予稿・単一節）で脚注スタイル時のみ分岐する。既存4スタイル（apa/ieee/sist02/mla）の出力は1ビットも変えない。

**Tech Stack:** Next.js 14 / TypeScript / `docx@8.5.0`（`FootnoteReferenceRun`・`Document({ footnotes })` は実測で構築確認済み）/ localStorage 永続。

## Global Constraints

- **テストランナーは無い**。検証は `npx tsc --noEmit`、`npx next build`、純粋ロジックは scratchpad の node スクリプト、docx出力の実体は node で `Packer.toBuffer`→unzip して XML を確認、アプリ実挙動はブラウザ実機（このリポジトリの既定運用）。
- **tsc/build は Node 24**: 各コマンド前に `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24.15.0 >/dev/null`。build 成功＝`✓ Generating static pages`（`unpdf`・`next.config` の既存 warning は無視）。
- **コミット**: `git -c user.name="Will" -c user.email="tachiiri@westernavenu.com" commit`、本文末尾 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。
- **スコープは論文のみ**。脚注体裁は `"jp-footnote"` 1値。**毎回フル注**（Ibid・短縮形なし）。**末尾リストも出す**（本編・予稿。単一節は脚注のみで末尾リストなし）。翻訳（bilingual）は対象外。
- **既存挙動不変が最重要**: 脚注は `isFootnoteStyle(style)` の分岐内だけ。既存4スタイルの本編/予稿/単一節・`citation-check`・PR-B2 ピッカー・PR-B1 紐付けは無改修・無変化。
- 参照本体は `project.references`（`Reference = { id, title, author?, source?, year?, url?, notes?, card? }`）。マーカーは `authorYearMarker(ref)`＝〔著者, 年〕（正準形）。
- **文字列アンカー必須**。行番号は参考値。

---

## Task 1: `citation.ts` — スタイル値・選択肢・述語・脚注フォーマッタ・防御ガード

**Files:**
- Modify: `src/lib/citation.ts`

**Interfaces:**
- Produces: `CitationStyle` に `"jp-footnote"`／`isFootnoteStyle(style: CitationStyle): boolean`／`formatNoteEntry(ref: Reference): string`（Task 2 が consume）。

- [ ] **Step 0: 裏取り（実装前に事実確認）**

Run 各コマンド。想定と違えば実装を止めて報告:
- `grep -n 'export type CitationStyle' src/lib/citation.ts` → `"apa" | "ieee" | "sist02" | "mla"` の union が1行で存在。
- `grep -n 'case "apa":' src/lib/citation.ts` → `formatBibliographyEntry` に `case "apa":`（default 同居）がある＝`jp-footnote` は apa 側に自然に落ちる（確認済み）。
- `grep -n "style === \"apa\" || style === \"sist02\"" src/lib/citation.ts` → `applyInTextCitations` の素通しガードが1件（この行にガードを足す）。

- [ ] **Step 1: 純粋ロジックの scratchpad サニティ**

`formatNoteEntry` の芯を移植して確認する。scratchpad に `pr-b3-note.mjs` を作成:

```js
function formatNoteEntry(ref) {
  const author = (ref.author ?? "").trim();
  const title = (ref.title ?? "").trim();
  const source = (ref.source ?? "").trim();
  const year = (ref.year ?? "").trim();
  const url = (ref.url ?? "").trim();
  const head = [author, title ? `『${title}』` : ""].filter(Boolean).join("");
  const tail = [source, year].filter(Boolean).join(", ");
  const core = [head, tail].filter(Boolean).join(" ").trim();
  const withDot = core ? `${core.replace(/[。.\s]*$/, "")}.` : `${title}.`;
  return url ? `${withDot} ${url}` : withDot;
}
console.log(formatNoteEntry({ author: "田中花子", title: "教育とAI", source: "日本教育工学会論文誌", year: "2021", url: "https://example.jp/a" }));
console.log(formatNoteEntry({ author: "Vaswani", title: "Attention Is All You Need", source: "NeurIPS", year: "2017" }));
console.log(formatNoteEntry({ title: "無著者資料" })); // 欠損フィールド
```

- [ ] **Step 2: サニティ実行**

Run: `node "$(dirname "$0")/pr-b3-note.mjs" 2>/dev/null || node /private/tmp/claude-*/**/scratchpad/pr-b3-note.mjs`（scratchpad の絶対パスで実行）
Expected:
```
田中花子『教育とAI』日本教育工学会論文誌, 2021. https://example.jp/a
Vaswani『Attention Is All You Need』NeurIPS, 2017.
無著者資料.
```
末尾がピリオド1個で、欠損フィールドが飛ばされていること。

- [ ] **Step 3: `CitationStyle` に値を追加**

`src/lib/citation.ts` の union を検索して置換:

置換前:
```ts
export type CitationStyle = "apa" | "ieee" | "sist02" | "mla";
```
置換後:
```ts
export type CitationStyle = "apa" | "ieee" | "sist02" | "mla" | "jp-footnote";
```

- [ ] **Step 4: `CITATION_STYLE_OPTIONS` に選択肢を追加**

MLA エントリ＋配列の閉じを検索して置換（`CITATION_STYLE_OPTIONS` 末尾。`  },\n];` は複数あり得るので MLA の help 文ごと一意に取る）:

置換前:
```ts
  {
    value: "mla",
    label: "MLA（著者）",
    help: "本文: 〔著者〕／一覧: 著者名順（Works Cited）。文学・言語・人文系",
  },
];
```
置換後:
```ts
  {
    value: "mla",
    label: "MLA（著者）",
    help: "本文: 〔著者〕／一覧: 著者名順（Works Cited）。文学・言語・人文系",
  },
  {
    value: "jp-footnote",
    label: "和文脚注",
    help: "本文: 上付き番号／ページ下部に脚注＋末尾に参考文献リスト（Word出力時）。人文・和文誌",
  },
];
```

- [ ] **Step 5: `isFootnoteStyle` を追加**

`isNumericStyle` の直後を検索して置換:

置換前:
```ts
/** 番号式（本文マーカーが [n]）かどうか */
export function isNumericStyle(style: CitationStyle): boolean {
  return style === "ieee";
}
```
置換後:
```ts
/** 番号式（本文マーカーが [n]）かどうか */
export function isNumericStyle(style: CitationStyle): boolean {
  return style === "ieee";
}

/** 脚注式（本文＝上付き番号／ページ下部＝脚注）かどうか */
export function isFootnoteStyle(style: CitationStyle): boolean {
  return style === "jp-footnote";
}
```

- [ ] **Step 6: `applyInTextCitations` に防御ガードを追加**

この関数は apa/sist02 以外を最終的に ieee の `[n]` 変換へ落とすため、脚注スタイルが万一渡っても本文を壊さないよう素通しに含める。検索して置換:

置換前:
```ts
  if (!body) return body;
  if (style === "apa" || style === "sist02") return body;
```
置換後:
```ts
  if (!body) return body;
  if (style === "apa" || style === "sist02" || isFootnoteStyle(style)) return body;
```

- [ ] **Step 7: `formatNoteEntry` を追加**

`authorYearMarker` 関数の直後を検索して置換（`authorYearMarker` の閉じ `}` ＋次のコメントで一意）:

置換前:
```ts
export function authorYearMarker(ref: Reference): string {
  const author = shortAuthor(ref);
  const year = (ref.year ?? "").trim();
  return year ? `〔${author}, ${year}〕` : `〔${author}〕`;
}
```
置換後:
```ts
export function authorYearMarker(ref: Reference): string {
  const author = shortAuthor(ref);
  const year = (ref.year ?? "").trim();
  return year ? `〔${author}, ${year}〕` : `〔${author}〕`;
}

/**
 * 和文脚注1件の本文テキスト。毎回フル形式なので状態を持たず ref だけで一意に決まる純粋関数。
 * 例: 著者『表題』誌名, 年. URL （欠損フィールドは飛ばす。行頭番号は docx の footnote 機能が振る）
 */
export function formatNoteEntry(ref: Reference): string {
  const author = (ref.author ?? "").trim();
  const title = ref.title.trim();
  const source = (ref.source ?? "").trim();
  const year = (ref.year ?? "").trim();
  const url = (ref.url ?? "").trim();
  const head = [author, title ? `『${title}』` : ""].filter(Boolean).join("");
  const tail = [source, year].filter(Boolean).join(", ");
  const core = [head, tail].filter(Boolean).join(" ").trim();
  const withDot = core ? `${core.replace(/[。.\s]*$/, "")}.` : `${title}.`;
  return url ? `${withDot} ${url}` : withDot;
}
```

- [ ] **Step 8: 型チェック**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24.15.0 >/dev/null; npx tsc --noEmit`
Expected: エラーなし。

- [ ] **Step 9: コミット**

```bash
git add src/lib/citation.ts
git -c user.name="Will" -c user.email="tachiiri@westernavenu.com" commit -m "$(printf 'feat: 引用スタイルに和文脚注(jp-footnote)を追加（isFootnoteStyle/formatNoteEntry・純粋関数）\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 2: `docx.ts` — 脚注コレクタと本文織り込み、3経路の分岐

**Files:**
- Modify: `src/lib/docx.ts`

**Interfaces:**
- Consumes: `isFootnoteStyle`・`formatNoteEntry`・`authorYearMarker`（Task 1／既存）、`Reference`（`./types`）、`FootnoteReferenceRun`（`docx`）。
- Produces: `FootnoteCtx` 型・`createFootnoteCtx(refs)`・`renderInlineWithFootnotes(text, ctx)`。`bodyParagraphs`/`sectionParagraphs` に `footnoteCtx?` 引数。

- [ ] **Step 0: 裏取り**

Run:
- `node -e "const d=require('/Users/will/tokitsukaze/node_modules/docx'); console.log(typeof d.FootnoteReferenceRun)"` → `function`（脚注 run が存在）。
- `grep -n 'function bodyParagraphs' src/lib/docx.ts` → 1件。
- `grep -c 'renderInline(' src/lib/docx.ts` → 複数（`bodyParagraphs` 内の呼び出しを Step 4 で `inline()` に差し替える）。

- [ ] **Step 1: docx出力の実体サニティ（node で .docx を作って unzip）**

脚注が実際に .docx に入るかを、アプリを通さず node で確認する。scratchpad に `pr-b3-docx.mjs` を作成:

```js
const { Document, Paragraph, TextRun, FootnoteReferenceRun, Packer } = require("/Users/will/tokitsukaze/node_modules/docx");
const fs = require("fs");
const { execSync } = require("child_process");
const entries = {
  1: { children: [new Paragraph({ children: [new TextRun("田中花子『教育とAI』日本教育工学会論文誌, 2021.")] })] },
  2: { children: [new Paragraph({ children: [new TextRun("Vaswani『Attention』NeurIPS, 2017.")] })] },
};
const doc = new Document({
  footnotes: entries,
  sections: [{ properties: {}, children: [
    new Paragraph({ children: [ new TextRun("本文A"), new FootnoteReferenceRun(1), new TextRun("本文B"), new FootnoteReferenceRun(2) ] }),
  ]}],
});
Packer.toBuffer(doc).then((buf) => {
  const out = "/tmp/pr-b3-check.docx";
  fs.writeFileSync(out, buf);
  const files = execSync(`unzip -l ${out}`).toString();
  console.log("has footnotes.xml:", files.includes("word/footnotes.xml"));
  const foot = execSync(`unzip -p ${out} word/footnotes.xml`).toString();
  console.log("note text present:", foot.includes("田中花子") && foot.includes("Vaswani"));
  const body = execSync(`unzip -p ${out} word/document.xml`).toString();
  console.log("body has footnoteReference:", body.includes("footnoteReference"));
});
```

- [ ] **Step 2: サニティ実行**

Run: `node /private/tmp/claude-*/**/scratchpad/pr-b3-docx.mjs`（scratchpad の絶対パスで）
Expected:
```
has footnotes.xml: true
note text present: true
body has footnoteReference: true
```
（＝`Document({ footnotes })` と `FootnoteReferenceRun` が実際に脚注XMLを出す。以降はこの形をアプリの本文レンダに配線するだけ。）

- [ ] **Step 3: import を追加**

`docx` の import に `FootnoteReferenceRun` を足す。検索して置換:

置換前:
```ts
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
import {
  applyInTextCitations,
  buildBibliography,
  DEFAULT_CITATION_STYLE,
} from "./citation";
```
置換後:
```ts
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
```

- [ ] **Step 4: `FootnoteCtx`・`createFootnoteCtx`・`renderInlineWithFootnotes` を追加**

`renderInline` 関数を検索し、その**直前**に以下を追加する（`function renderInline(` は1件で一意）:

置換前:
```ts
function renderInline(text: string): TextRun[] {
```
置換後:
```ts
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
```

- [ ] **Step 5: `bodyParagraphs` に `footnoteCtx?` を足して分岐**

シグネチャと本文冒頭・各 `renderInline(...)` 呼び出しを差し替える。まずシグネチャと `src` を検索して置換:

置換前:
```ts
function bodyParagraphs(body: string, transform?: (t: string) => string): (Paragraph | Table)[] {
  if (!body) return [para("（本文未生成）")];
  const out: (Paragraph | Table)[] = [];
  // 論文モード: 引用マーカーのスタイル変換（〔著者, 年〕→[n] 等）を Markdown 解析より前に適用
  const src = transform ? transform(body) : body;
```
置換後:
```ts
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
```

- [ ] **Step 6: `bodyParagraphs` 内の4つの `renderInline(...)` を `inline(...)` に差し替え**

同関数内の見出し・箇条書き・引用・平文の各行で `renderInline` を `inline` に替える。4件を個別に置換する:

(6a) 見出し:
```tsx
          children: renderInline(h[2].trim()),
```
→
```tsx
          children: inline(h[2].trim()),
```

(6b) 箇条書き（`・` 付き。`new TextRun("・")` を含む行で一意）:
```tsx
      out.push(new Paragraph({ children: [new TextRun("・"), ...renderInline(b[1])] }));
```
→
```tsx
      out.push(new Paragraph({ children: [new TextRun("・"), ...inline(b[1])] }));
```

(6c) 引用（`q[1]` で一意）:
```tsx
      out.push(new Paragraph({ children: renderInline(q[1]) }));
```
→
```tsx
      out.push(new Paragraph({ children: inline(q[1]) }));
```

(6d) 平文（`renderInline(line)` で一意）:
```tsx
    out.push(new Paragraph({ children: renderInline(line) }));
```
→
```tsx
    out.push(new Paragraph({ children: inline(line) }));
```

- [ ] **Step 7: `sectionParagraphs` に `footnoteCtx?` を素通しで追加**

シグネチャと `bodyParagraphs` 呼び出しを検索して置換:

置換前:
```ts
function sectionParagraphs(
  draft: SectionDraft,
  includeNotes = false,
  transformBody?: (t: string) => string,
): (Paragraph | Table)[] {
  const blocks: (Paragraph | Table)[] = [];
  blocks.push(heading(draft.sectionTitle, HeadingLevel.HEADING_2));
  // 本文冒頭にAIが付けた重複見出し（番号付き）を除去してから流す
  blocks.push(
    ...bodyParagraphs(stripLeadingDuplicateHeading(draft.body, draft.sectionTitle), transformBody),
  );
```
置換後:
```ts
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
```

- [ ] **Step 8: `exportProjectDocx`（本編）を脚注対応に分岐**

(8a) `transformBody` の算出を検索して置換（脚注モード時は文字列変換を止め、コレクタを作る）:

置換前:
```ts
  const transformBody =
    isPaper && paperRefs.length > 0
      ? (t: string) => applyInTextCitations(t, paperRefs, citationStyle, allBodyText)
      : undefined;
```
置換後:
```ts
  const footnoteMode = isPaper && paperRefs.length > 0 && isFootnoteStyle(citationStyle);
  const footnoteCtx = footnoteMode ? createFootnoteCtx(paperRefs) : undefined;
  const transformBody =
    isPaper && paperRefs.length > 0 && !footnoteMode
      ? (t: string) => applyInTextCitations(t, paperRefs, citationStyle, allBodyText)
      : undefined;
```

(8b) `sectionParagraphs` 呼び出しに `footnoteCtx` を渡す。検索して置換:

置換前:
```ts
          children.push(...sectionParagraphs(draft, includeNotes, transformBody));
```
置換後:
```ts
          children.push(...sectionParagraphs(draft, includeNotes, transformBody, footnoteCtx));
```

(8c) Document 構築に `footnotes` を条件付きで渡す。検索して置換（本編の Document。`title: project.name` で一意）:

置換前:
```ts
  const doc = new Document({
    creator: "アキカゼ出版AI",
    title: project.name,
    sections: [{ properties: {}, children }],
  });
  await downloadDoc(doc, `アキカゼ出版AI_全体原稿ドラフト_${fileSafe(project.name)}.docx`);
```
置換後:
```ts
  const doc = new Document({
    creator: "アキカゼ出版AI",
    title: project.name,
    ...(footnoteCtx ? { footnotes: footnoteCtx.entries } : {}),
    sections: [{ properties: {}, children }],
  });
  await downloadDoc(doc, `アキカゼ出版AI_全体原稿ドラフト_${fileSafe(project.name)}.docx`);
```

（末尾の参考文献リストは既存コードのまま＝脚注＋末尾リストの両方が出る。`buildBibliography` は `jp-footnote` を apa 側で整形する。）

- [ ] **Step 9: `exportPreprintDocx`（予稿）を脚注対応に分岐**

(9a) `transformBody` 算出を検索して置換:

置換前:
```ts
  const transformBody =
    paperRefs.length > 0
      ? (t: string) => applyInTextCitations(t, paperRefs, citationStyle, preprint)
      : undefined;
  children.push(...bodyParagraphs(preprint, transformBody));
```
置換後:
```ts
  const footnoteMode = paperRefs.length > 0 && isFootnoteStyle(citationStyle);
  const footnoteCtx = footnoteMode ? createFootnoteCtx(paperRefs) : undefined;
  const transformBody =
    paperRefs.length > 0 && !footnoteMode
      ? (t: string) => applyInTextCitations(t, paperRefs, citationStyle, preprint)
      : undefined;
  children.push(...bodyParagraphs(preprint, transformBody, footnoteCtx));
```

(9b) Document 構築に `footnotes` を条件付きで渡す。検索して置換（予稿の Document。`title: `${project.name}（予稿）`` で一意）:

置換前:
```ts
  const doc = new Document({
    creator: "アキカゼ出版AI",
    title: `${project.name}（予稿）`,
    sections: [{ properties: {}, children }],
  });
  await downloadDoc(doc, `予稿_${fileSafe(project.name)}.docx`);
```
置換後:
```ts
  const doc = new Document({
    creator: "アキカゼ出版AI",
    title: `${project.name}（予稿）`,
    ...(footnoteCtx ? { footnotes: footnoteCtx.entries } : {}),
    sections: [{ properties: {}, children }],
  });
  await downloadDoc(doc, `予稿_${fileSafe(project.name)}.docx`);
```

- [ ] **Step 10: `exportSectionDocx`（単一節）を脚注対応に分岐（末尾リストなし）**

関数本体を検索して置換（`front.push(spacer());` から Document 構築まで。単一節は末尾リストを付けない＝脚注のみ）:

置換前:
```ts
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
```
置換後:
```ts
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
```

- [ ] **Step 11: 型チェック＋ビルド**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24.15.0 >/dev/null; npx tsc --noEmit && npx next build 2>&1 | grep -iE "Failed|error:|✓ Generating"`
Expected: tsc エラーなし・`✓ Generating static pages`。
※ もし `footnotes` の型で tsc が落ちたら、`entries` の型を `Record<number, { children: Paragraph[] }>` のまま `footnotes: footnoteCtx.entries` が `{ [key: string]: { children: readonly Paragraph[] } }` に代入可能なはず（number キーは string 添字に適合、`Paragraph[]` は `readonly Paragraph[]` に適合）。落ちる場合のみ Document 呼び出しで `footnotes: footnoteCtx.entries as Record<string, { children: Paragraph[] }>` にする。

- [ ] **Step 12: コミット**

```bash
git add src/lib/docx.ts
git -c user.name="Will" -c user.email="tachiiri@westernavenu.com" commit -m "$(printf 'feat: Word出力で和文脚注を織り込み（本文=上付き番号/ページ下部=脚注・毎回フル・3経路分岐）\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 3: 実出力検証（コントローラ）＋既存スタイルの回帰

**Files:**
- 変更なし（検証のみ）。不具合は Task 1/2 に戻して修正。

**Interfaces:**
- Consumes: Task 1・2 の成果。

- [ ] **Step 1: node で実 .docx の脚注XMLを確認（アプリのロジックを移植して検証）**

Task 1/2 の実装から `formatNoteEntry`・`createFootnoteCtx`・`renderInlineWithFootnotes`・`authorYearMarker` を1つの `pr-b3-e2e.mjs` に移植し（依存は `docx` のみ・`renderInline` は `text => [new TextRun(text)]` のスタブでよい）、次を組む:
- refs = `[{id:"r1",title:"Attention",author:"Vaswani",year:"2017",source:"NeurIPS"},{id:"r2",title:"教育とAI",author:"田中花子",year:"2021",source:"日本教育工学会論文誌"}]`
- body = `"序論。〔Vaswani, 2017〕 が基礎。さらに〔田中花子, 2021〕。再度〔Vaswani, 2017〕。"`
- `const ctx = createFootnoteCtx(refs); const runs = renderInlineWithFootnotes(body, ctx);`
- `new Document({ footnotes: ctx.entries, sections:[{properties:{},children:[new Paragraph({children: runs})]}] })` を `Packer.toBuffer`→`/tmp/pr-b3-e2e.docx` に保存→unzip。

Run: `node /private/tmp/claude-*/**/scratchpad/pr-b3-e2e.mjs`
Expected（脚注コンソール出力で確認）:
- `ctx.nextId - 1 === 3`（同一文献2回＝別 id で計3脚注採番＝毎回フル）。
- `word/footnotes.xml` に「Vaswani」「田中花子」の両方が含まれる。
- `word/document.xml` に `footnoteReference` が3回出る。
- 本文XMLに `〔Vaswani, 2017〕` の**文字列が残っていない**（マーカーは脚注参照に置換済み）。

- [ ] **Step 2: ブラウザで seed→スタイル選択→出力（実挙動スモーク）**

`preview_start`（name: dev。※worktree が異なる場合は該当 worktree で `next dev` を起動しそのURLを開く）。`javascript_tool` で論文プロジェクトを seed（`kikigaki:projects:v2`）:
- `genre:"paper"`、`references` に上記 r1/r2、節1つ、`generatedSections` にその節の `body`（マーカー2種・r1は2回）を入れ、`paperMeta.citationStyle:"jp-footnote"`。
- `/writer` を開き `read_console_messages`（onlyErrors）でエラー0。
- 「全体Wordを出力」「Wordで保存（単一節）」を押し、ダウンロードが**例外なく発火**する（`FootnoteReferenceRun`＋`Document({footnotes})` がアプリ実行時に構築できることの確認）。`read_console_messages` でエラー0。

Expected: いずれもコンソールエラーなし・ダウンロード発火。実ファイルの体裁は本番/手元 Word で最終確認（この環境では Step 1 の node unzip が体裁の裏取り）。

- [ ] **Step 3: 既存スタイルの回帰（最重要）**

seed の `paperMeta.citationStyle` を `"apa"`→`"ieee"`→`"mla"`→`"sist02"` に変えて（`javascript_tool` で localStorage 書き換え＋リロード）、「全体Wordを出力」がエラーなく発火し、Step 1 相当の node 検証で **apa は本文にマーカーが残る／ieee は `[n]` に変換される（従来どおり）／footnotes.xml が生成されない**ことを確認する（脚注は `jp-footnote` のときだけ）。

Expected: 4スタイルとも従来どおり。`footnoteCtx` 無しパスが不変。

- [ ] **Step 4: 検証結果を記録**

コード変更が出た場合のみ該当 Task に戻して修正・再検証。無ければ本 Task はコミット無しで完了。node unzip の要点（脚注3件・本文マーカー消失・回帰OK）を PR 説明に添える。

---

## Self-Review（この計画のスペック突合）

- **`CitationStyle` に jp-footnote 追加＋選択肢**（spec ①）→ Task 1 Step 3/4 ✅
- **isFootnoteStyle / formatNoteEntry（純粋関数）**（spec ②）→ Task 1 Step 5/7 ✅
- **applyInTextCitations 防御ガード**（spec ②）→ Task 1 Step 6 ✅
- **末尾リストは buildBibliography 流用・apa 側整形**（spec ②④）→ Task 2 は本編/予稿の既存リストコードを残すだけ ✅
- **FootnoteCtx＋renderInlineWithFootnotes＋bodyParagraphs/sectionParagraphs の footnoteCtx**（spec ③）→ Task 2 Step 4-7 ✅
- **3経路分岐（本編・予稿・単一節）＋Document({footnotes})、翻訳は対象外**（spec ④）→ Task 2 Step 8-10 ✅
- **単一節は末尾リストなし・脚注のみ**（spec ④）→ Task 2 Step 10 ✅
- **毎回フル＝出現ごと新 id**（spec 決定2）→ Task 2 Step 4（alloc）＋ Task 3 Step 1（3件採番の確認）✅
- **既存4スタイル不変**（spec テスト3）→ Task 2 は分岐内のみ改修＋ Task 3 Step 3 で回帰確認 ✅
- **UI はセレクタに1項目（コード追加は CITATION_STYLE_OPTIONS のみ）**（spec ⑤）→ Task 1 Step 4 ✅
- 非スコープ（付番・英文シカゴ・Ibid・直交組合せ・翻訳脚注・ページ番号）は本計画に含めない ✅

Placeholder スキャン: 「適切に処理」等の曖昧語なし・全コードブロック実体あり。型整合: `FootnoteCtx`/`createFootnoteCtx`/`renderInlineWithFootnotes`/`isFootnoteStyle`/`formatNoteEntry`/`footnoteCtx` は Task 間で一貫。
