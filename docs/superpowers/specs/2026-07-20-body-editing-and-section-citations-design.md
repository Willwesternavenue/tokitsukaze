# 本文の手動編集 ＋ 節ごとの引用 — 設計書

最終更新: 2026-07-20

## これは何か

執筆画面（/writer）に2つの機能を足す。

1. **本文の手動編集**（全ジャンル） — 生成された本文を、AI再生成に頼らず直接テキスト編集できるようにする。現状は翻訳モードだけが編集可能で、論文・聞き書き等は読み取り専用（`<div className="draft-body">`）。
2. **節ごとの引用**（論文優先） — 各節に「使う文献」を紐付けて生成に反映しつつ、本文エディタから引用マーカーを手動挿入できるようにする。

2は1に依存する（手動挿入は本文が編集可能でないと成立しない）ため、**PR-A（本文編集・土台）→ PR-B（節ごとの引用）** の順で実装する。

## 背景・現状

- **本文編集は「実装済みだが翻訳モード限定」**。ストレージ層（`replaceDraftBody` + `SectionDraft.bodyHistory` + `diffLines`/`diffStats`）はジャンル非依存で既にある。しかし編集UI（「訳文を編集」ボタン→textarea→「保存（旧版を退避）」）が `isTranslation` でゲートされている（`src/app/writer/page.tsx`）。したがって「本文編集を全ジャンルに」＝**既存フローの開放**であり、新規実装ではない（リスクは主に翻訳フローとの共有部）。
- **引用は現状「グローバル登録＋AI自動挿入」のみ**。`/references` に登録 → 生成時に `buildPaperContext` が「登録文献だけ〔著者, 年〕を許可、無ければ〔要出典〕」と指示 → AIが自動でマーカーを付ける。ユーザーが「この節にこの文献を」と能動的に指定する手段がない。
- 関連する既存資産:
  - `src/lib/citation.ts` … `authorYearMarker(ref)`（正準マーカー生成）、スタイル別フォーマッタ。
  - `src/workflows/agents/reviewers.ts` の `citation-check` … 本文マーカーと登録文献の突合。
  - `src/lib/docx.ts` … Word出力時にマーカーをスタイル変換し参考文献リストを付加。
  - `src/app/writer/page.tsx` … `locked` フラグ（`setSectionLocked`）で波及再生成から節を保護。`handlePropagate` が locked 節をスキップ。

## 決定事項（ブレインストーミングの結論）

- **Q1 = C**: 「節への文献紐付け」と「手動マーカー挿入」の**両方**を提供する。
- **Q2 = A**: 手動編集した節は**自動で保護（`locked=true`）**にし、再生成・波及再生成から守る。編集前の版は常に `bodyHistory` に退避され、差分から復元できる。
- **引用の紐付けは HINT 型**: 節に紐付けた文献を「優先的に引用」として生成に渡すが、他の登録文献の引用は禁止しない（RESTRICT ではない）。
- **スコープは論文優先**: まず paper で成立させる。データ構造・UIは `/references`（`project.references`）を持つ business・news にも自然に広がる形にするが、v1 の検証対象は paper。

---

## PR-A: 本文の手動編集（土台）

### データ

- 追加なし。既存の `SectionDraft.body` / `SectionDraft.bodyHistory` / `SectionDraft.locked` を使う。

### 挙動

- **編集の開始/保存**: `/writer` の本文表示に「本文を編集」ボタンを出す（現状 `isTranslation` 限定の `editingBody`/`bodyDraft`/`handleStartEditBody`/`handleSaveBody` を全ジャンルで再利用）。保存は既存 `replaceDraftBody(chapterId, sectionId, newBody, "手動編集前")` で、旧版を `bodyHistory`（最大10版）に退避。
- **自動保護（Q2=A）**: 保存時にその節を `locked=true` に自動設定する（`setSectionLocked` を保存処理に組み込む）。これにより `本文を再生成` / 波及再生成（`handlePropagate`）で手動編集が上書きされない。UI に「手動編集済み（保護中）」バッジを出し、ロック解除で再生成可能に戻す。
- **差分ビュー**: 非翻訳でも「変更差分」タブ（既存 `diffLines`/`diffStats`）を開放し、`bodyHistory` があれば旧版と比較できる。
- **翻訳モードは現状維持**: 対訳ビュー・再翻訳・一括翻訳・訳文編集の既存フローは変えない。共有関数に触るため、翻訳の挙動が変わらないことをリグレッションで担保する。

### UI 配置

- 本文パネルのアクション行（「本文を再生成」等の並び）に「本文を編集」を追加。編集中は textarea＋「保存」「キャンセル」。
- 読み取り専用表示 `<div className="draft-body">` と編集 textarea を、非翻訳ブランチでも切り替えられるようにする（翻訳ブランチの構造を踏襲）。

### 触るファイル（見込み）

- `src/app/writer/page.tsx`（本文レンダリング分岐・編集ボタン・保存時の自動ロック）
- `src/lib/storage.ts`（必要なら `replaceDraftBody` に「保存時ロック」オプション、または writer 側で `setSectionLocked` を続けて呼ぶ）

---

## PR-B: 節ごとの引用（PR-A 依存）

### データ

- `Section.referenceIds?: string[]` を追加（構成の節に、その節で使う文献のIDを紐付ける。文献本体は既存 `project.references`）。`mergeDefaults` 相当の後方互換は optional なので不要（未設定＝紐付けなし）。

### ①紐付け → 生成反映（HINT 型）

- `/writer` で節を選ぶと「この節で使う文献」チェックリストを表示（`project.references` から選択、`section.referenceIds` に保存）。
- `buildPaperContext`（および将来的に business/news の draft context）で、紐付け文献を「**この節で優先的に引用する文献**」として system prompt に明示する。紐付けが空の節は従来通り（全登録文献が引用候補）。
- 送信経路: 生成は `startSectionDraft` → `/api/generate-draft` → `draftWorkflow`。節オブジェクト（`section`）はそのまま送られるので `referenceIds` も届く。`slimProjectForDraft` は `selectedOutline` を削っても `section` 本体は別で送るため影響を確認する（リグレッション項目）。

### ②手動マーカー挿入（PR-A のエディタ上）

- 本文エディタ（PR-A の textarea）に「引用を挿入」ボタンを追加。押すと `project.references` のピッカー（節に紐付いた文献を上に、他を下に）を表示。
- 選ぶと、その文献の `authorYearMarker(ref)`（〔著者, 年〕）を**カーソル位置**に挿入する（`textarea.selectionStart` を使用）。挿入後も通常どおり「保存」で確定（自動ロック）。

### 整合性（追加改修が要らないことの確認）

- 挿入・生成されたマーカーは既存 `citation-check`（本文マーカー↔登録文献の突合）にそのまま乗る。
- Word 出力（`exportProjectDocx`/`exportSectionDocx`/`exportPreprintDocx`）のスタイル変換・参考文献リストにもそのまま乗る（マーカーは正準形なので）。

### 触るファイル（見込み）

- `src/lib/types.ts`（`Section.referenceIds`）
- `src/app/writer/page.tsx`（節の文献チェックリスト・「引用を挿入」ピッカー）
- `src/workflows/draft.ts`（`buildPaperContext` に紐付け文献の優先指示）
- `src/lib/citation.ts`（挿入に使う `authorYearMarker` は既存。必要なら小ヘルパ追加）

---

## リグレッション・テスト計画（重点）

PR-A / PR-B とも、既存挙動を壊さないことを実ブラウザで確認する（ローカルにAIキーが無いため、AI生成が絡む項目は「送信内容・プロンプト」レベルの確認＋本番での実生成確認に分ける）。

1. **翻訳モード**: 対訳/訳文タブ、訳文編集→保存、再翻訳、一括翻訳、変更差分が従来通り（`editingBody` 共有部に触るため最重要）。
2. **自動ロック**: 手動編集→保存でその節が「保護中」になり、波及再生成（`handlePropagate`）でスキップされる。ロック解除で再生成対象に戻る。
3. **本文を再生成**: ロック節での再生成ボタンの扱い（保護 or 確認ダイアログ）が意図通り。
4. **bodyHistory / diff**: 10版上限、差分表示が非翻訳でも動く。編集を繰り返しても壊れない。
5. **引用紐付けの送信**: `slimProjectForDraft` が `section.referenceIds` を落とさず生成APIに届く。
6. **Word 出力3種**: 編集後本文・挿入マーカーで全体/セクション/予稿が正常に出力され、スタイル変換・参考文献リストが崩れない。
7. **citation-check**: 手動挿入したマーカーが登録文献と正しく突合され、未登録なら error になる。
8. **他ジャンルの読み取り表示**: 編集UIを足しても、未生成節・空本文の表示が壊れない。

## 非スコープ（今回やらない）

- business・news での節ごと引用の作り込み（データ構造は共通化するが、v1 の検証は paper のみ）。
- 引用の RESTRICT 型（紐付け文献しか引用させない）。将来オプションとして検討可能。
- 脚注番号・ページ番号レベルの引用（`Reference` への `pages?`/`doi?` 追加は別途）。
- リッチテキスト編集（Markdown/WYSIWYG）。編集はプレーンテキスト textarea のまま。

## 未確定・実装時に確認する点

- `本文を再生成`（単体）ボタンが、ロック済み節でどう振る舞うか現状を精査し、Q2=A と矛盾しないようにする（保護 or 明示確認）。
- `buildPaperContext` の紐付け文献指示の文言（「優先的に引用」の強さ）は本番の実生成で調整する。
