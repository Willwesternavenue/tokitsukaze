# PR-B3: 和文脚注モード（本文＝上付き番号 / ページ下部＝脚注） — 設計書

最終更新: 2026-07-22（ブレインストーミング確定）

## これは何か

論文モードに **「和文脚注」** という引用体裁を1つ追加する。選ぶと Word 出力時に、本文中の引用が**上付き番号**になり、**ページ下部に脚注**（`docx` の footnote 機能）として文献情報が入る。人文系・和文誌で標準の note-bibliography 形式。

**本文中のマーカーは従来どおり `authorYearMarker(ref)` 〔著者, 年〕を正準として保存し、脚注化は Word 出力時のみ**行う。これにより `citation-check`・localStorage・生成プロンプト・PR-B2 のピッカーは無改修で成立する（「本文のマーカーは常に正準形」という既存の invariant を崩さない）。

## 位置づけ（引用アークの続き）

- PR-A（本文の手動編集）／ PR-B1（節への文献紐付け→生成反映）／ PR-B2（本文エディタの引用挿入ピッカー）は **main にマージ済み**。
- PR-B3 は「引用スタイル選択＋参考文献リスト Word 出力」（既存 `apa/ieee/sist02/mla`）の**続きの1スタイル**。既存が全て**インライン式**（本文にマーカー／番号を残す）だったのに対し、B3 は初めて**脚注式**（本文から注へ退避）を入れる。

## 決定事項（ブレインストーミングで確定）

1. **出力形態 = 真の脚注**（`FootnoteReferenceRun` + `Document({ footnotes })`）。文末注ではなくページ下部脚注。
2. **繰り返しは毎回フル引用**。同じ文献を複数回引用したら毎回フル形式の脚注を出す（`Ibid.`・短縮形・op. cit. はやらない）。→ `citation.ts` を純粋関数のまま保てる。
3. **末尾の参考文献リストも出す**（脚注＋末尾リストの両方＝note-bibliography 形式）。既存 `buildBibliography` を流用。
4. **同一著者・同年の付番（2020a/2020b）は非スコープ**（別途）。
5. **脚注体裁は1種（和文脚注）のみ**。英文シカゴ note 式は非スコープ。
6. **方式 A**（新しい `CitationStyle` 値を1つ追加）。配置を直交フラグにする方式Bは、v1（脚注1種）には過剰なので不採用。

## 背景・現状（実装前調査で確認済みの事実）

- `src/lib/citation.ts`（純粋関数・AI不使用）:
  - `CitationStyle = "apa" | "ieee" | "sist02" | "mla"`（既定 `apa`。`PaperMeta.citationStyle?` は optional で、未設定は apa フォールバック＝union 拡張はマイグレ不要）。
  - `authorYearMarker(ref)` → 〔著者, 年〕（本文の正準マーカー）。
  - `isNumericStyle(style)`（IEEE=`[n]` 判定）、`orderReferences`、`formatBibliographyEntry(ref, style, ...)`、`buildBibliography(refs, style, bodyText)`、`applyInTextCitations(text, refs, style, allBodyText)`（**文字列→文字列**変換）、`citationInstruction(style)`。
  - `CITATION_STYLE_OPTIONS: { value, label, help }[]`（`/` のセレクタ元）。
- `src/lib/docx.ts`（`docx@8.5.0` / `file-saver`）:
  - `bodyParagraphs(body, transform?)` — `transform` があれば**本文全体に文字列変換**を当ててから Markdown を行単位で解析し、各行を `renderInline(line)` で TextRun 化する。
  - `renderInline(text): TextRun[]` — `**bold**`/`*italic*`/`` `code` `` を処理。マーカー〔著者, 年〕は特殊文字を含まないのでこの正規表現分割と干渉しない。
  - `sectionParagraphs(draft, includeNotes, transformBody?)` → `bodyParagraphs` を呼ぶ。
  - 出力4経路: `exportProjectDocx`（本編・末尾に参考文献リストあり）／`exportPreprintDocx`（予稿・末尾リストあり）／`exportSectionDocx`（単一節・**末尾リストなし・現状は引用変換も未適用でマーカーが素のまま残る**）／`exportBilingualDocx`（翻訳・対象外）。
  - `Document({ sections: [...] })` で構築。`footnotes` は未使用。
- **`docx@8.5.0` の脚注 API（実測で確認）**:
  - `new FootnoteReferenceRun(id: number)` は `Run` を継承 → Paragraph の `children` に TextRun と並べて直接置ける。
  - `new Document({ footnotes: { [id]: { children: [Paragraph] } }, sections: [...] })` が構築成功（`footnotes` は `sections` と同列のトップレベルキー）。
  - ※ HANDOFF 事実①（docx@8.5 は脚注対応）を本設計で再確認した（一時的に `undefined` に見えたが、クリーンな require では関数として存在・構築成功）。

## 設計

### ① データ & スタイルモデル

- `CitationStyle` に `"jp-footnote"` を追加:
  ```ts
  export type CitationStyle = "apa" | "ieee" | "sist02" | "mla" | "jp-footnote";
  ```
  optional union の拡張なので既存 localStorage は無傷・マイグレ不要。
- `CITATION_STYLE_OPTIONS` に1項目追加:
  ```ts
  { value: "jp-footnote", label: "和文脚注",
    help: "本文は上付き番号、ページ下部に脚注。末尾に参考文献リストも付きます（Word出力時）。" }
  ```
- 本文中のマーカーは**従来どおり `authorYearMarker` 〔著者, 年〕**。脚注化は Word 出力時のみ。→ `citation-check`・生成プロンプト・PR-B2 ピッカーは無改修。

### ② `citation.ts` の追加（純粋関数のまま）

- `isFootnoteStyle(style: CitationStyle): boolean` — `style === "jp-footnote"`（`isNumericStyle` と同列の述語）。
- `formatNoteEntry(ref: Reference): string` — 脚注1件の本文テキスト。和文整形（例: `著者『タイトル』誌名/出版社, 年.`、URL があれば末尾に付す）。**毎回フル**なので状態引数を持たず `ref` だけで一意に決まる純粋関数。行頭番号は持たない（番号は docx の footnote 機能が振る）。
- 末尾の参考文献リストは既存 `buildBibliography` を流用する。`jp-footnote` は `formatBibliographyEntry` の **`case "apa": default:` 側（著者・年の和文整形・行頭番号なし）** にそのまま落ちる（確認済み）。番号式ではないので `isNumericStyle("jp-footnote") === false`（末尾リストに `[n]` 番号は付かない）。
- **`applyInTextCitations` の防御ガード**: 現状この関数は `style === "apa" || "sist02"` で素通し、`mla` で年落とし、それ以外は**すべて ieee の `[n]` 変換に落ちる**。脚注パスはそもそもこの関数を通さない設計だが、事故防止として早期素通しガードに `isFootnoteStyle(style)` を足す（`if (style === "apa" || style === "sist02" || isFootnoteStyle(style)) return body;`）。万一呼ばれても本文マーカーを壊さない。

### ③ `docx.ts` の脚注織り込み（本設計の核心）

現状のマーカー変換は「文字列→文字列」の `transform`（`applyInTextCitations`）で Markdown 解析前に当てている。脚注は `FootnoteReferenceRun`（docx オブジェクト）＋ `Document({ footnotes })` への id 登録であり、この文字列パスには乗らない。したがって脚注スタイル時は**文字列変換パスを使わず、本文レンダリング中に注を織り込む別パス**に切り替える。

- **脚注コレクタ**を1つ用意し、1回の export 全体を通す:
  ```ts
  type FootnoteCtx = {
    refs: Reference[];                                   // project.references（孤児は authorYearMarker 突合で自然除外）
    nextId: number;                                      // 1 始まり・文書全体で連番
    entries: Record<number, { children: Paragraph[] }>;  // Document({ footnotes }) にそのまま渡す形
    alloc(ref: Reference): number;                       // 出現ごとに新 id 採番し entries に formatNoteEntry を登録して返す
  };
  ```
- `bodyParagraphs(body, transform?)` に **`footnoteCtx?: FootnoteCtx` 引数を追加**。
  - `footnoteCtx` が**ある**とき: `transform` は通さず、各行内テキストを `renderInlineWithFootnotes(text, footnoteCtx)` で処理する。
  - `footnoteCtx` が**ない**とき: 現状のまま（`transform` パス）。**＝既存4スタイルの挙動を1ビットも変えない。**
- **`renderInlineWithFootnotes(text, ctx): (TextRun | FootnoteReferenceRun)[]`**（新規・独立関数）:
  - `ctx.refs` の各 `authorYearMarker(ref)` 文字列で `text` を分割する。
  - マーカー一致箇所 → `new FootnoteReferenceRun(ctx.alloc(ref))` を runs に差し込む（本文には上付き番号だけが残る／マーカー文字列自体は消える）。
  - 非マーカー区間 → 既存 `renderInline(segment)` に委譲する（**既存関数は無改修**）。
  - マーカーは `〔〕`と読点のみで Markdown 特殊文字を含まないため、太字/斜体の分割と干渉しない。
- `sectionParagraphs` にも `footnoteCtx?` を素通しで足す（`bodyParagraphs` へ渡すだけ）。
- Document 構築時、脚注スタイルなら `footnotes: footnoteCtx.entries` を渡す（`sections` と同列のキー追加）。
- **毎回フルの帰結**: 同じ文献の2回目の引用も `alloc` が新しい id を採番＝別番号の脚注（フル）を出す。これが決定2「毎回フル引用」の意味に一致する。番号は文書全体で連番。

### ④ 出力経路のカバレッジと末尾リスト

対象は**論文の3経路**。各経路で「脚注スタイルか」を `isFootnoteStyle(citationStyle)` で判定し、分岐する。

| 経路 | 脚注スタイル時の挙動 | インライン既存スタイル時（不変） |
|---|---|---|
| `exportProjectDocx`（本編） | `footnoteCtx` パスで脚注織り込み＋ Document に `footnotes`。**末尾に参考文献リスト**（`buildBibliography`）。 | 従来どおり `applyInTextCitations` 変換＋末尾リスト。 |
| `exportPreprintDocx`（予稿） | 同上（脚注＋末尾リスト）。 | 従来どおり。 |
| `exportSectionDocx`（単一節） | `footnoteCtx` パスで脚注織り込み＋ Document に `footnotes`。**末尾リストは付けない**（断片扱い＝現状踏襲）。 | 従来どおり（変換なし・マーカー素通し）。 |
| `exportBilingualDocx`（翻訳） | **対象外**（触らない）。 | 触らない。 |

- 脚注スタイル時、従来の `applyInTextCitations` 文字列変換は**通さない**（本文にマーカーを残す代わりに脚注参照へ退避するため）。
- 各経路で `footnoteCtx` は**その export の呼び出しごとに新規生成**（id は経路内で 1 始まり）。

### ⑤ UI

- `/`（論文仕様パネル）の既存 `citationStyle` セレクタに「和文脚注」を1項目足すだけ（`CITATION_STYLE_OPTIONS` への追加で自動的にセレクタへ出る）。新規 UI コンポーネントなし。
- PR-B2 のピッカーは無改修で共存（挿入するのは常に正準マーカー〔著者, 年〕。脚注化は出力時なのでピッカー側は関知しない）。

## リグレッション・テスト計画

このリポジトリの作法（テストランナー無し。`npx tsc --noEmit`／`npx next build`／ブラウザ・Word 実出力／純粋ロジックは scratchpad node）に従う。

1. **純粋ロジック（scratchpad node）**:
   - `isFootnoteStyle` の真偽、`formatNoteEntry(ref)` の和文整形（著者/タイトル/誌名/年/URL 有無）。
   - コレクタの id 採番: 同一文献を2回 `alloc` すると別番号、entries に2件登録される。
   - `renderInlineWithFootnotes`: マーカー一致→参照 run、非一致→テキスト、太字（`**…**`）と混在しても壊れない。孤児マーカー（`refs` に無い）は素通し（脚注化しない）。
2. **Word 実出力（実際に .docx を開く）**: 論文プロジェクト（文献複数・本文に同一/複数マーカー）で3経路を書き出し、本文が上付き番号／ページ下部に和文脚注／番号が文書内連番／末尾リストは本編・予稿にあり単一節に無し、を確認。
3. **回帰（最重要）**: 既存4スタイル（apa/ieee/sist02/mla）の本編/予稿/単一節が**従来どおり**（`footnoteCtx` 無しパスは不変）。`citation-check` が手動/生成マーカーを従来どおり突合。PR-B2 ピッカー・PR-B1 紐付けが無改修で動く。
4. `npx tsc --noEmit` パス／`npx next build` 40/40。

## 非スコープ（今回やらない・明記）

- **付番（2020a/2020b）** — 別途。
- **英文シカゴ note 式・`Ibid.`／短縮形／op. cit.** — 毎回フルで割り切る。
- **脚注 × 他スタイルの直交組合せ**（方式B）。脚注は `jp-footnote` 1値に閉じる。
- **翻訳（bilingual）への脚注**。
- **ページ番号つき脚注**（`〔著者, 年, p.12〕`）・`Reference` への `pages?`/`doi?` 追加。
- **文末注（endnote）**。ページ下部脚注のみ。

## 触るファイル（見込み）

- `src/lib/citation.ts`（`CitationStyle` union、`CITATION_STYLE_OPTIONS`、`isFootnoteStyle`、`formatNoteEntry`、`buildBibliography`/`formatBibliographyEntry` の default 分岐）
- `src/lib/docx.ts`（`FootnoteCtx`、`renderInlineWithFootnotes`、`bodyParagraphs`/`sectionParagraphs` への `footnoteCtx?` 追加、3経路の分岐と `Document({ footnotes })`）
- UI は `CITATION_STYLE_OPTIONS` 追加のみで既存セレクタに反映（`/` 論文仕様パネルのコード変更は不要の見込み。実装時に確認）
