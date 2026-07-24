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
- **一致しなかった候補**（未一致／曖昧／既引用／未知ref）は「**要手動**」として別セクションに表示し、各行に `〔著者, 年〕` と**該当文**を出す。手挿しは PR-B2 ピッカーへ誘導（ピッカーはキャレット位置に挿すため、ユーザーが該当文にキャレットを置く一手間がある。該当文を明示することでその段差を緩和。v1 はこの体験で許容）。
- 実行中はボタンを「解析中…」に。AI未設定/失敗時はエラー表示（`extract-reference-card` と同じ体裁）。

### ② API 契約（同期await型）

- 新規 `POST /api/annotate-citations`（`runtime="nodejs"`）。入力 JSON `{ body: string, references: Reference[], field?: string, researchQuestion?: string }`。`field`/`researchQuestion` は `project.paperMeta.field` / `project.paperMeta.researchQuestion`（いずれも既存 `string`。空でもプロンプトは成立）。
- 内部で `const run = await start(annotateCitationsWorkflow, [input]); const result = await run.returnValue;`。
- 返り値 `{ proposals: CitationProposal[], meta }`。`CitationProposal = { quote: string; refId: string; reason: string }`。
- クライアント helper `annotateSectionCitations(body, references): Promise<CitationProposal[]>`（`src/lib/translationClient.ts` に追加、`postJson` 利用）。

### ③ ワークフロー `annotateCitationsWorkflow`（`referenceCard.ts` に倣う）

- `src/workflows/citationAnnotate.ts` に新規。`"use step"` 関数がプロンプトでモデルを1回呼び、**JSON配列**をパース。
- プロンプト骨子（保守的）:
  - 与える：節本文（原文ママ）＋全登録文献（`title` / `author` / `year` / `notes` / カルテ要約＋各文献の `refId` と `authorYearMarker`）。
  - 指示：「本文中で、**登録文献が明確に支持する主張**にだけ引用を付ける。無ければ付けない。**文章は一切変えない**（言い換え・要約・加筆に加え、**約物や全角半角の変更も禁止**）。`quote` は引用を付けたい主張を含む文の**逐語断片**を、本文から**一字一句そのまま**コピーして返す（全角半角・鉤括弧・ダッシュ等を勝手に正規化しない。**本文中で一意に定まる長さ**にする）。マーカーの正確な挿入位置は**アプリが句点基準で決める**ので、`quote` は文を一意に特定できれば足りる（句点で切る必要はない）。`refId` は与えた登録文献のIDのみ、`reason` は選定根拠を短く。」
  - 出力スキーマ：`{ proposals: [{ quote, refId, reason }] }`。パース失敗・途中で切れた JSON は referenceCard と同じくリトライ（`attempts`）／`ok:false`。**節が長いと proposals と逐語 quote で出力が膨らむ**ため `maxTokens` は referenceCard（2500）より大きめ（例: 4000、`src/lib/ai.ts` の既定4096以内）に設定する。

### ④ アンカー照合＆マーカー位置決定＆挿入（純粋ロジック `src/lib/citationAnnotate.ts`）

「地の文不変」はこのモジュールだけで機械的に保証する。核は3つ：**照合は厳密一致のみ／index は常に元本文のオフセット／マーカー位置はアプリが句点基準で確定する**（AI の quote 切り方に依存しない）。純粋モジュール（`"use client"` なし）。

```ts
export type CitationProposal = { quote: string; refId: string; reason: string };
export type AnnotationItem = {
  proposal: CitationProposal;
  ref: Reference;
  insertAt: number;   // 元本文のオフセット。この直前にマーカーを挿す（＝句点の直前）
  marker: string;     // authorYearMarker(ref)
};
export type SkippedItem = {
  proposal: CitationProposal;
  ref?: Reference;
  why: "no-match" | "ambiguous" | "unknown-ref" | "already-cited";
};
export type AnnotationPlan = { applied: AnnotationItem[]; needsManual: SkippedItem[] };

/** proposals を元本文に対して検証し、挿入計画を作る（本文はまだ変えない）。 */
export function planAnnotations(body: string, proposals: CitationProposal[], refs: Reference[]): AnnotationPlan;

/** 採用する applied 項目だけを元本文へ挿入して新本文を返す。 */
export function applyAnnotations(body: string, chosen: AnnotationItem[]): string;
```

**`planAnnotations`（proposal ごとに）**
1. `refId` が `refs` に無ければ `needsManual("unknown-ref")`。
2. **厳密一致**で `quote` を本文検索（`indexOf`。正規化しない）：0件→`no-match`／2件以上→`ambiguous`／ちょうど1件→次へ。全角半角・鉤括弧種・ダッシュ・スペースの揺れはすべて `no-match` に落ちる＝要手動。**照合は緩めない**（正規化して比較すると index が元本文とズレ、マーカーが数文字ずれて刺さり「地の文不変」が崩れるため。緩める最適化は精度データを見てから別途）。
3. **マーカー位置はアプリが確定**：`quoteEnd = matchIndex + quote.length` から同じ行内で最初の文末記号（`。｜！｜？`）を探し、その**直前**を `insertAt` にする（→ `…である〔著者, 年〕。`）。行内に文末が無ければ行末（`\n` 直前）／本文末を `insertAt` に。AI が quote をどこで切ったかに依存しない。
4. **再実行の安全（already-cited）**：`insertAt` の属する文（直近の文頭〜その文末）に既に引用マーカー `〔…〕` があれば `needsManual("already-cited")`。2回目実行の二重挿入を「壊れたら戻す」ではなく**壊れない**形で防ぐ。
5. 通れば `applied` に `{ proposal, ref, insertAt, marker: authorYearMarker(ref) }`。
6. **決定論的 dedup / 並び**：同一 `(insertAt, refId)` は1件に統合。同一 `insertAt` に複数 `refId` は **proposal 配列順**で安定に並べる（`〔A, 2020〕〔B, 2021〕`＝A が先に提案された文献）。

**`applyAnnotations`**：`chosen` を `insertAt` **降順**（同 `insertAt` は proposal 順の**逆**を二次キー）で並べ、右→左に `body.slice(0,insertAt)+marker+body.slice(insertAt)` を適用。右→左なので未適用側のオフセットは不変、同位置の複数マーカーは最終的に proposal 順（左→右）に並ぶ。**出力＝元 body ＋ 採用マーカーのみ**（地の文は1文字も変わらない）。

**マーカー生成の頑健性**：`authorYearMarker` は著者欠損時に `title` へフォールバックする（`title` は必須）ため空マーカー `〔, 〕` は生成され得ない。よって「マーカー生成不能で弾く」処理は不要。著者欠損文献が `〔表題〕` と冗長になる点は採否時に人が判断（許容）。

UI は `applied` を一覧化しチェックした部分集合を `applyAnnotations` に渡す。`needsManual` は理由別（未一致/曖昧/既引用/未知ref）に**該当文とともに**表示する。

### ⑤ 保存・版・ロック

- **必ず復元点を作る**。`saveManualBodyEdit`（`src/lib/storage.ts:691`）は「直前が `手動編集前` かつ5分以内」の手動保存を**圧縮**するため、`本文を編集`→即 retrofit のような順序だと **retrofit 前の版が `bodyHistory` に残らない**。retrofit は独立した意味のある一括変更なので圧縮対象にしない。
- 実装：`replaceDraftBody(chapterId, sectionId, newBody, "AI引用差し込み前")`（常に1版積む・圧縮しない）で旧本文を退避し、続けて **PR-A と同じ自動保護**（`bodyEditedAt` 更新＋論文で未ロックなら `locked=true`/`lockReason="manual"`）を付与する。この2つをまとめた薄いヘルパ `applyCitationAnnotationsSave(chapterId, sectionId, newBody)` を storage に足すのが素直（`saveManualBodyEdit` に「圧縮しない」フラグを足す最小拡張でも可）。決定5（自動ロック）を満たす。
- 「変更差分」から retrofit 前へ復元できる。ロック済み節に再実行しても毎回1版積むので復元可能。

## 非スコープ（今回やらない）

- 地の文の書き換え・要約・言い換え・加筆（一切しない）。
- 新規文献の作成（登録済みのみ使用。未登録候補は出さない）。
- 文書全体の一括実行／レビュー無し全自動適用（節ごと・1件ずつ採否）。
- 体裁変換・脚注化・参考文献リスト（既存 Word 出力／PR-B3 が担当。retrofit は正準マーカーを入れるだけ）。
- 曖昧一致（複数ヒット）の自動解決（「要手動」へ回す。手挿しは PR-B2）。
- 照合の正規化（全角半角・約物の揺れ吸収）。v1 は厳密一致のみ・揺れは要手動。緩める最適化は採用率データを見てから別途。
- ページ番号つき引用・同一著者同年の付番（`2020a/2020b`）は別途。retrofit は複数文献を一括で入れるため最も踏みやすい：**同一著者・同年の2文献を両方採用すると同一マーカー `〔著者, 年〕` になり、`citation-check` は通るが人間・参考文献リストでは区別できない**（v1 はこの限界を明記して許容）。

## リグレッション・テスト計画（テストランナー無し）

1. **純粋ロジック（scratchpad node・実装より先に固める）**: `planAnnotations`／`applyAnnotations` が正しければ本機能の安全性はほぼ担保されるので、ここを最初に確定する。
   - 振り分け：一意ヒット→applied、0件→no-match、複数→ambiguous、未登録refId→unknown-ref。
   - **厳密一致**：全角半角・鉤括弧種・ダッシュ・スペースが揺れた quote は `no-match` に落ちる（正規化して誤った index を作らない）。
   - **マーカー位置**：quote が文中どこで終わっても `insertAt` は文末記号の直前になり `…〔著者, 年〕。` の形。文末が無い行は行末。
   - **already-cited**：既に `〔…〕` がある文への提案はスキップ（同じ本文で2回 plan→apply しても二重挿入されない＝再実行安全）。
   - **dedup / 並び**：同一 `(insertAt, refId)` 統合。同一 `insertAt` の複数 refId が proposal 順（左→右）に並ぶ。
   - `applyAnnotations`：右→左 splice で全マーカーが正位置、出力＝元body＋採用マーカーのみ（**地の文差分ゼロ**をアサート）、採用0件なら本文不変。
   - **保存**：`replaceDraftBody` で毎回1版積み、`本文を編集`→即 retrofit でも retrofit 前の版が `bodyHistory` に残る（圧縮されない）。自動ロックが掛かる。
2. `npx tsc --noEmit` ／ `npx next build`。
3. **実機（ブラウザ）**: 論文を seed（本文マーカー無し＋登録文献複数）→「AIで引用を差し込む」。ローカルにAIキーが無ければ、`/api/annotate-citations` を**モック応答**（既知の quote/refId を返す）に差し替えるか、`planAnnotations`/`applyAnnotations` をコンソールで直接叩いて、レビュー一覧→採用→本文の該当位置にマーカー・地の文差分ゼロ→`citation-check` が未登録errorを出さない→`bodyHistory` に旧版、を確認。実生成の精度は本番で確認。
4. **回帰**: 既存の `本文を再生成`／`本文を編集`（PR-A/B2）／`citation-check`／Word出力（体裁・脚注）が無改修で従来どおり。

## 触るファイル（見込み）

- 新規 `src/lib/citationAnnotate.ts`（型 `CitationProposal`/`AnnotationItem`/`SkippedItem`/`AnnotationPlan`＋純粋関数 `planAnnotations`/`applyAnnotations`）
- 新規 `src/workflows/citationAnnotate.ts`（`annotateCitationsWorkflow`。`referenceCard.ts` に倣う）
- 新規 `src/app/api/annotate-citations/route.ts`（`extract-reference-card` に倣う同期await route）
- Modify `src/lib/translationClient.ts`（クライアント helper `annotateSectionCitations`）
- Modify `src/lib/storage.ts`（保存ヘルパ `applyCitationAnnotationsSave`＝`replaceDraftBody` 相当の常時1版退避＋PR-A自動ロック。または `saveManualBodyEdit` に非圧縮フラグ）
- Modify `src/app/writer/page.tsx`（「AIで引用を差し込む」ボタン・レビューパネル・採用適用・保存/ロック）
- （必要なら）プロンプトテンプレを `defaultPrompts` に追加、または workflow 内インライン（referenceCard の流儀に合わせる）
