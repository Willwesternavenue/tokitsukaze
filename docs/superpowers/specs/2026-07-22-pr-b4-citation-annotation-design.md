# PR-B4: 既存本文への引用差し込み（retrofit citation annotation） — 設計書

最終更新: 2026-07-22（ブレインストーミング確定）

## これは何か

**すでに書かれた本文を書き換えずに、AIが適切な箇所へ引用マーカー `〔著者, 年〕` を差し込む**機能。論文モードの節ごとに実行し、AIは「差し込み位置＋文献ID」だけを返す。地の文はアプリが機械挿入するので**1文字も変わらない**。提案は**1件ずつ採否**でき、誤引用を人が弾ける。

現状、登録文献を本文へ反映する手段は「本文を再生成（＝文章ごと作り直し）」か「PR-B2 ピッカーで手挿し」しかない。**作り込んだ文章を保ったまま、多数の登録文献をまとめて引用付けする**手段が無い。本機能はその空白を埋める。

## 位置づけ（引用アーク）

styles（APA/IEEE/SIST02/MLA）／ PR-A（本文の手動編集）／ PR-B1（節への文献紐付け）／ PR-B2（挿入ピッカー）／ PR-B3（和文脚注）は **main にマージ済み**。PR-B4 は「手挿しピッカー（PR-B2）の自動化」。挿入するのは既存と同じ**正準マーカー `authorYearMarker(ref)`**なので、体裁変換・脚注化・参考文献リスト・`citation-check` はすべて既存のまま乗る（無改修）。

## 決定事項（ブレインストーミングで確定）

1. **実行単位＝節ごと**（`本文を再生成` と同じ粒度。節にボタン1つ）。
2. **本文保証＝AIは「位置＋文献ID」だけ返す**。AIは本文からの**逐語アンカー(quote)**＋`refId`＋`reason` を返し、**アプリが元テキストにマーカーを機械挿入**。地の文は不変。一致しないアンカーはスキップして「要手動」に回す。
3. **採否＝1件ずつ**。各候補を `[☑] 〔著者, 年〕 ← 「該当文」（根拠）` で一覧化し、採用した分だけ本文に入る。
4. **候補文献＝全登録文献**（notes/カルテも渡してAIが各主張に最も合う文献を選ぶ。事前の紐付け不要）。
5. **反映後は自動ロック**（論文で未ロックの節は `lockReason="manual"`。波及再生成で引用が消えないように。ユーザー解除可）。

## 背景・現状（実装前に確認済みの事実）

- **同期await型のAI経路**（`extract-reference-card` が手本）: route が `const run = await start(workflow, [input]); const result = await run.returnValue;` して JSON を返す。`AIConfigError`→500、`result.ok===false`→502。ポーリング不要。
- **ワークフローの形**（`referenceCard.ts` が手本）: `export async function xWorkflow(input): Promise<Result>` → `"use step"` 関数がプロンプト（`defaultPrompts` テンプレ or インライン）でモデルを呼び、JSON をパースして `{ ok, <data>, meta:{model,provider,attempts,runId} }` を返す。
- **正準マーカー**: `authorYearMarker(ref)` → `〔著者, 年〕`（`src/lib/citation.ts`、純粋関数）。
- **突合**: `citation-check`（`src/workflows/agents/reviewers.ts`）が本文マーカーを登録文献と突き合わせ、未登録は error。retrofit は登録文献IDしか使わないので突合を壊さない。
- **保存・退避**: `replaceDraftBody(chapterId, sectionId, newBody, note)`（`src/lib/storage.ts:661`）が旧本文を `bodyHistory`（最大10版）へ退避。`saveManualBodyEdit`（同:691）が手動編集の自動ロック（`bodyEditedAt`＋`lockReason`）を扱う。PR-A の自動保護はここ。
- **手挿しピッカー（PR-B2）**: `/writer` 本文エディタの「引用を挿入」。要手動候補はこれで挿せる。

## 設計

### ① UX / フロー

- 節の本文エリアに「**AIで引用を差し込む**」ボタン（`本文を再生成` の隣）。論文モードかつ本文生成済みかつ `references.length>0` のときだけ表示。
- 押すと `/api/annotate-citations` を呼び、返った候補を**レビューパネル**に一覧表示：各行
  `[☑] 〔著者, 年〕 ―「…該当文（quoteの周辺）…」 根拠: <reason>`
- 「**選択を本文に反映**」で、**採用チェックした候補だけ**を元本文へ挿入 → 保存。「キャンセル」で破棄。
- **一致しなかった候補**（本文と逐語一致しない／複数箇所ヒットで曖昧）は「**要手動**」として別セクションに表示（`〔著者, 年〕` と該当文を出す）。手挿しは PR-B2 ピッカーへ誘導。
- 実行中はボタンを「解析中…」に。AI未設定/失敗時はエラー表示（`extract-reference-card` と同じ体裁）。

### ② API 契約（同期await型）

- 新規 `POST /api/annotate-citations`（`runtime="nodejs"`）。入力 JSON `{ body: string, references: Reference[], field?: string, researchQuestion?: string }`。
- 内部で `const run = await start(annotateCitationsWorkflow, [input]); const result = await run.returnValue;`。
- 返り値 `{ proposals: CitationProposal[], meta }`。`CitationProposal = { quote: string; refId: string; reason: string }`。
- クライアント helper `annotateSectionCitations(body, references): Promise<CitationProposal[]>`（`src/lib/translationClient.ts` に追加、`postJson` 利用）。

### ③ ワークフロー `annotateCitationsWorkflow`（`referenceCard.ts` に倣う）

- `src/workflows/citationAnnotate.ts` に新規。`"use step"` 関数がプロンプトでモデルを1回呼び、**JSON配列**をパース。
- プロンプト骨子（保守的）:
  - 与える：節本文（原文ママ）＋全登録文献（`title` / `author` / `year` / `notes` / カルテ要約＋各文献の `refId` と `authorYearMarker`）。
  - 指示：「本文中で、**登録文献が明確に支持する主張**にだけ引用を付ける。無ければ付けない。**文章は一切変えない**（本文の言い換え・要約・加筆は禁止）。同じ箇所に二重に付けない。各引用について、マーカーを置きたい位置の**直前まで**の本文を `quote` として**逐語**で返す（`。` の手前で切る。**本文中で一意に定まる長さ**にする）。`refId` は与えた登録文献のIDのみ。`reason` に選定根拠を短く。」
  - 出力スキーマ：`{ proposals: [{ quote, refId, reason }] }`。パース失敗時は referenceCard と同じくリトライ／`ok:false`。

### ④ アンカー照合＆挿入（純粋ロジック `src/lib/citationAnnotate.ts`）

型と純粋関数を新規ファイルに置く（`citation.ts` は肥大回避のため分離）。`docx.ts`/UI から使うため `"use client"` は付けない純粋モジュール。

```ts
export type CitationProposal = { quote: string; refId: string; reason: string };
export type AnnotationPlan = {
  applied: { proposal: CitationProposal; ref: Reference; index: number; marker: string }[];
  needsManual: { proposal: CitationProposal; ref?: Reference; why: "no-match" | "ambiguous" | "unknown-ref" }[];
};

/** proposals を元本文に対して検証し、挿入計画を作る（本文はまだ変えない）。 */
export function planAnnotations(body: string, proposals: CitationProposal[], refs: Reference[]): AnnotationPlan;

/** 採用する applied 項目だけを元本文へ挿入して新本文を返す（オフセット降順で右→左 splice）。 */
export function applyAnnotations(body: string, chosen: AnnotationPlan["applied"]): string;
```

- `planAnnotations`：各 proposal について
  - `refId` が `refs` に無い → `needsManual(unknown-ref)`。
  - `quote` の本文出現回数を数える：1回→`applied`（`index` = quote 末尾のオフセット、`marker` = `authorYearMarker(ref)`）／0回→`needsManual(no-match)`／2回以上→`needsManual(ambiguous)`。
- `applyAnnotations`：採用項目を `index` の**降順**に並べ、`body.slice(0,index) + marker + body.slice(index)` を右→左で適用。**出力＝元 body ＋ 採用マーカーのみ**（地の文不変）。
- UI は `planAnnotations` の結果を一覧化し、ユーザーがチェックした `applied` 部分集合を `applyAnnotations` に渡す。

### ⑤ 保存・版・ロック

- 反映は **`本文を編集` の保存と同じ経路** `saveManualBodyEdit(selected.chapter.id, selected.section.id, newBody, /*isManualEdit=*/ true)`（`src/lib/storage.ts:691`）を再利用する。これ1本で (a) 旧本文を `bodyHistory` に退避（「変更差分」から復元可・PR-A の連続保存圧縮も踏襲）、(b) `bodyEditedAt` 更新、(c) 論文で未ロックの節なら自動ロック（`lockReason="manual"`）——決定5をそのまま満たす。追加の状態を持たない。
- `bodyHistory` の note は `saveManualBodyEdit` 既定（`"手動編集前"`）を使う。retrofit 専用の note を出し分けたい場合のみ、同関数に任意 note 引数を足す（最小拡張・任意）。
- ロック済み節に再実行しても `saveManualBodyEdit` が旧版を退避するので復元可能。

## 非スコープ（今回やらない）

- 地の文の書き換え・要約・言い換え・加筆（一切しない）。
- 新規文献の作成（登録済みのみ使用。未登録候補は出さない）。
- 文書全体の一括実行／レビュー無し全自動適用（節ごと・1件ずつ採否）。
- 体裁変換・脚注化・参考文献リスト（既存 Word 出力／PR-B3 が担当。retrofit は正準マーカーを入れるだけ）。
- 曖昧一致（複数ヒット）の自動解決（「要手動」へ回す。手挿しは PR-B2）。
- ページ番号つき引用・同一著者同年の付番（別途）。

## リグレッション・テスト計画（テストランナー無し）

1. **純粋ロジック（scratchpad node）**: `planAnnotations` — 一意ヒット→applied、0件→no-match、複数→ambiguous、未登録refId→unknown-ref の振り分け。`applyAnnotations` — 複数採用を右→左 splice して全マーカーが正位置、出力＝元body＋採用マーカーのみ（地の文差分ゼロ）、採用0件なら本文不変。
2. `npx tsc --noEmit` ／ `npx next build`。
3. **実機（ブラウザ）**: 論文を seed（本文マーカー無し＋登録文献複数）→「AIで引用を差し込む」。ローカルにAIキーが無ければ、`/api/annotate-citations` を**モック応答**（既知の quote/refId を返す）に差し替えるか、`planAnnotations`/`applyAnnotations` をコンソールで直接叩いて、レビュー一覧→採用→本文の該当位置にマーカー・地の文差分ゼロ→`citation-check` が未登録errorを出さない→`bodyHistory` に旧版、を確認。実生成の精度は本番で確認。
4. **回帰**: 既存の `本文を再生成`／`本文を編集`（PR-A/B2）／`citation-check`／Word出力（体裁・脚注）が無改修で従来どおり。

## 触るファイル（見込み）

- 新規 `src/lib/citationAnnotate.ts`（`CitationProposal`/`AnnotationPlan`/`planAnnotations`/`applyAnnotations`。純粋関数）
- 新規 `src/workflows/citationAnnotate.ts`（`annotateCitationsWorkflow`。`referenceCard.ts` に倣う）
- 新規 `src/app/api/annotate-citations/route.ts`（`extract-reference-card` に倣う同期await route）
- Modify `src/lib/translationClient.ts`（クライアント helper `annotateSectionCitations`）
- Modify `src/app/writer/page.tsx`（「AIで引用を差し込む」ボタン・レビューパネル・採用適用・保存/ロック）
- （必要なら）プロンプトテンプレを `defaultPrompts` に追加、または workflow 内インライン（referenceCard の流儀に合わせる）
