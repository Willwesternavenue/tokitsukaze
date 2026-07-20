# 本文の手動編集 ＋ 節ごとの引用 — 設計書

最終更新: 2026-07-20（レビュー反映・改訂）

## これは何か

執筆画面（/writer）に2つの機能を足す。

1. **本文の手動編集**（全ジャンル） — 生成された本文を、AI再生成に頼らず直接テキスト編集できるようにする。現状は翻訳モードだけが編集可能で、論文・聞き書き等は読み取り専用（`<div className="draft-body">`）。
2. **節ごとの引用**（論文優先） — 各節に「使う文献」を紐付けて生成に反映しつつ、本文エディタから引用マーカーを手動挿入できるようにする。

## PR 分割（レビュー P4 反映）

依存関係で3本に分ける。

- **PR-A**: 本文の手動編集（土台）。
- **PR-B1**: 節への文献紐付け → 生成反映。**PR-A に依存しない**（`Section.referenceIds` + `buildPaperContext` + チェックリストUIで完結）。プロンプト文言の実生成チューニングを先行して始められる。
- **PR-B2**: 本文エディタでの手動マーカー挿入。**PR-A に依存する**（編集可能な textarea が前提）。

## 背景・現状

- **本文編集は「実装済みだが翻訳モード限定」**。ストレージ層（`replaceDraftBody` + `SectionDraft.bodyHistory` + `diffLines`/`diffStats`）はジャンル非依存で既にある。編集UI（「訳文を編集」→textarea→「保存」）が `isTranslation` でゲートされている（`src/app/writer/page.tsx`）。**現状 writer で編集できるのは訳文(body)のみ**で、原文（`section.sourceText`）は読み取り専用。
- **引用は現状「グローバル登録＋AI自動挿入」のみ**。`/references` に登録 → `buildPaperContext` が「登録文献だけ〔著者, 年〕を許可、無ければ〔要出典〕」と指示。ユーザーが「この節にこの文献を」と能動指定する手段がない。
- 既存資産: `src/lib/citation.ts`（`authorYearMarker(ref)`）、`citation-check`（`src/workflows/agents/reviewers.ts`）、`src/lib/docx.ts`（マーカー→スタイル変換＋文献リスト）、`locked`/`setSectionLocked`/`handlePropagate`（波及再生成の保護）。

## 決定事項（ブレインストーミング＋レビュー反映）

- **Q1 = C**: 「節への文献紐付け」と「手動マーカー挿入」の両方。
- **Q2 = A**: 手動編集した節は自動で保護（`locked`）。編集前の版は `bodyHistory` に退避。
- 引用の紐付けは **HINT 型**（優先はするが他の登録文献の引用も禁止しない）。
- スコープは **論文優先**（データ・UIは business・news にも広がる形にするが、v1 検証は paper）。

---

## PR-A: 本文の手動編集（土台）

### データ（レビュー P1・P2 反映）

`SectionDraft` に2つ追加（どちらも optional・後方互換）:

- `bodyEditedAt?: string` — 最後に手動編集した時刻。**「手動編集済み」バッジ表示はこれで判定**（`locked` とは独立させ、意味の二重化を避ける）。
- `lockReason?: "user" | "manual"` — ロックの由来。手動編集の自動ロックは `"manual"`、ユーザーが明示的に掛けたロックは `"user"`。

`editingBody: boolean`（writer のローカル state）を **`editingTarget: null | "body"`** に置き換える（将来 `"translation"`/原文編集を足しても破綻しない形。命名を編集対象ベースにする）。

### 挙動

- **編集の開始/保存**: 本文表示に「本文を編集」ボタン。既存 `handleStartEditBody`/`bodyDraft`/`handleSaveBody` を全ジャンルで再利用。保存は `replaceDraftBody(chapterId, sectionId, newBody, "手動編集前")`。
- **自動保護（Q2=A・P1 反映）**: 保存時に `bodyEditedAt` を更新し、**その節が現在ロックされていなければ** `locked=true` / `lockReason="manual"` を立てる。
  - **ユーザーが手動ロックを解除したら再ロックしない**: ユーザーが `lockReason="manual"` の節のロックを外した場合、以後その節では自動ロックを行わない（＝ユーザー意思の尊重）。この「解除の記憶」は実装計画で最小の持ち方を決める（候補: 解除時に `lockReason` を消し、`bodyEditedAt` があるのに未ロックの節は「自動ロック対象外」とみなす／あるいは `autoLockOptOut?: boolean` を持つ）。
  - バッジ: `bodyEditedAt` があれば「手動編集済み」、さらに `locked && lockReason==="manual"` なら「（保護中）」を付す。ロック解除導線を明示。
- **`bodyHistory` の圧縮（P3 反映）**: 手動編集は高頻度なので、`.slice(-10)` の固定上限だとAI原版がすぐ押し出される。**直前の履歴が手動編集（`note==="手動編集前"`）かつ短時間（例: 5分以内）なら、履歴を積み増さず最新版で上書き**して連続保存をまとめる。これにより「本当に戻りたいAI生成版」を10版枠に温存する。閾値は実装時に調整。
- **未保存のまま節切替（P2 反映）**: 編集中（`editingTarget!==null` かつ `bodyDraft` が退避元と差分あり）に別の節/章へ移動しようとしたら**確認ダイアログ**（「未保存の編集を破棄して移動しますか？」）。破棄 or 留まる。自動保存はしない（明示保存モデルを崩さない）。
- **差分ビュー**: 非翻訳でも「変更差分」タブ（既存 `diffLines`/`diffStats`）を開放。
- **翻訳モードは現状維持**（対訳/再翻訳/一括翻訳/訳文編集）。

### 触るファイル（見込み）

- `src/lib/types.ts`（`SectionDraft.bodyEditedAt`・`lockReason`〔・必要なら `autoLockOptOut`〕）
- `src/app/writer/page.tsx`（`editingTarget` 化・編集ボタン・自動ロック判定・未保存確認・非翻訳の差分タブ）
- `src/lib/storage.ts`（`replaceDraftBody` に履歴圧縮ロジック、または保存ヘルパを追加）

---

## PR-B1: 節への文献紐付け → 生成反映（PR-A 非依存）

### データ

- `Section.referenceIds?: string[]`（構成の節に、その節で使う文献IDを紐付け。本体は既存 `project.references`）。未設定＝紐付けなし（従来どおり全登録文献が引用候補）。

### 挙動（HINT 型）

- `/writer` で節を選ぶと「この節で使う文献」チェックリスト（`project.references` から選択、`section.referenceIds` に保存）。
- **`buildPaperContext` のシグネチャ変更（P5 反映）**: 現状 `buildPaperContext(project)` は節を受けない。`buildPaperContext(project, section?)` に変更し、`section.referenceIds` があれば該当文献を「**この節で優先的に引用する文献**」として system prompt に明示。呼び出し箇所（`draft.ts:214`）を更新。空なら従来出力。
- **送信経路の保証（P5b 反映）**: 生成は `startSectionDraft` → `/api/generate-draft`。`section` は独立パラメータで送られ `referenceIds` も届く。プロンプトに著者・年を書くには**文献メタ本体が必要**なので、`slimProjectForDraft` が `project.references` を落とさないことを保証する（現状 `...project` 起点で references は残る。リグレッションで固定）。
- **孤児 referenceId（P6 反映）**: `/references` から文献を削除すると `section.referenceIds` にIDが残り得る。**表示時・プロンプト生成時の両方で `project.references` と突合してフィルタ**して無害化する（存在しないIDは無視）。カスケード削除は非スコープ。

### 触るファイル（見込み）

- `src/lib/types.ts`（`Section.referenceIds`）
- `src/app/writer/page.tsx`（節の文献チェックリスト・孤児フィルタ）
- `src/workflows/draft.ts`（`buildPaperContext(project, section)` と呼び出し）

---

## PR-B2: 手動マーカー挿入（PR-A 依存）

### 挙動

- PR-A の本文エディタ（textarea）に「引用を挿入」ボタン。押すと `project.references` のピッカー（節に紐付いた文献を上に、他を下に）。
- 選ぶと `authorYearMarker(ref)`（〔著者, 年〕）を**カーソル位置**に挿入し、`bodyDraft` を更新。保存で確定（PR-A の自動ロックが掛かる）。
- **`selectionStart` の消失対策（P7 反映）**: ボタン押下で textarea からフォーカスが外れ選択位置が失われ得る。**ピッカーを開く直前の `selectionStart`/`selectionEnd` を控える**（またはボタンの `onMouseDown` で `preventDefault`）。モーダルピッカー前提なら「開いた瞬間の選択位置を保持」が確実。
- **自動ロックの強さ（P8 反映）**: マーカー1つの挿入でも保存経由で自動ロックされ、以後の波及再生成から外れる。v1 は本文書き直しと**同一扱いで割り切る**。代わりにバッジ（「手動編集済み（保護中）」）とロック解除導線を分かりやすくして、ユーザーが状態と復帰手段を把握できるようにする。

### 整合性（追加改修が不要なことの確認）

- 挿入・生成マーカーは既存 `citation-check`（突合）と Word出力（スタイル変換＋文献リスト）にそのまま乗る（マーカーは正準形）。

### 触るファイル（見込み）

- `src/app/writer/page.tsx`（「引用を挿入」ボタン・ピッカー・選択位置保持）
- `src/lib/citation.ts`（`authorYearMarker` は既存。必要なら小ヘルパ）

---

## リグレッション・テスト計画（重点）

ローカルにAIキーが無いため、AI生成が絡む項目は「送信内容・プロンプト」レベルの確認＋本番での実生成確認に分ける。

1. **翻訳モード基本**: 対訳/訳文タブ、訳文編集→保存、再翻訳、一括翻訳、変更差分が従来通り（共有 state に触るため最重要）。
2. **翻訳モードで本文編集→タブ切替→保存（P2 追加）**: 訳文編集中に対訳/差分タブへ切り替え→戻って保存しても、正しい対象（body）に書き込まれ状態が壊れない。
3. **未保存のまま節切替（P2 追加）**: 編集中に別節へ移動→確認ダイアログが出て、破棄/留まるが意図通り。
4. **自動ロックとロック解除の記憶（P1）**: 手動編集→保存でその節が「保護中（manual）」になり波及再生成でスキップ。ユーザーが解除→再編集しても**再ロックされない**。
5. **本文を再生成（単体）**: ロック節での再生成の扱い（保護 or 確認）が意図通り。
6. **bodyHistory 圧縮（P3）**: 手動編集を短時間に連続してもAI原版が10版枠から押し出されない。差分表示が非翻訳でも動く。
7. **引用紐付けの送信（P5b）**: `slimProjectForDraft` 後も `project.references`（本体）と `section.referenceIds` が生成APIに届く。
8. **孤児 referenceId（P6）**: 紐付け後に文献を削除しても、チェックリスト表示・プロンプト生成が壊れず存在IDのみ使う。
9. **Word 出力3種**: 編集後本文・挿入マーカーで全体/セクション/予稿が正常、スタイル変換・文献リストが崩れない。
10. **citation-check**: 手動挿入マーカーが登録文献と突合され、未登録なら error。
11. **他ジャンルの読み取り表示**: 編集UI追加後も、未生成節・空本文の表示が壊れない。

## 非スコープ（今回やらない）

- **同一著者・同年の曖昧性（P9）**: `authorYearMarker` は 2020a/2020b の付番を持たず、同一著者・同年の複数文献が同一マーカーになる。v1 は**この限界を明記して非スコープ**とする（`citation-check`・docx文献リストも区別不可）。将来 `authorYearMarker` に付番パスを足す。
- 引用の RESTRICT 型（紐付け文献しか引用させない）。
- business・news での節ごと引用の作り込み（データ構造は共通化するが v1 検証は paper のみ）。
- 文献削除時のカスケード（孤児は表示・生成時フィルタで無害化）。
- 脚注番号・ページ番号レベルの引用（`Reference` への `pages?`/`doi?`）。
- リッチテキスト編集（プレーン textarea のまま）。

## 実装時に確認する点

- `本文を再生成`（単体）ボタンがロック済み節でどう振る舞うか現状を精査し、Q2=A と矛盾しないようにする。
- `buildPaperContext` の紐付け文献指示の文言（「優先的に引用」の強さ）は本番の実生成で調整（PR-B1 で先行）。
- ロック解除の記憶（`autoLockOptOut` を持つか、`lockReason` クリア＋`bodyEditedAt` 併用で表現するか）の最小実装を計画で確定。
- `bodyHistory` 圧縮の時間閾値。
