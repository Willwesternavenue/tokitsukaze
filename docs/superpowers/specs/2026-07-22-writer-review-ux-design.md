# 執筆・レビューUX改善（指示付き再生成 / 解決する・解決済み / 執筆レイアウト固定） — 設計書

最終更新: 2026-07-22（ブレインストーミング確定）

## これは何か

執筆・レビュー画面に3つの独立した改善を入れる。

1. **A. 指示付きの本文再生成** — 「本文を再生成」に任意のコメント（指示）を添えられるようにし、指示に沿って内容を変える。現状は指示が無く同じ文脈→同じ出力になりがちで「なかみが変わらない」。
2. **レビューの「解決する」／「解決済み」** — レビューカードに (a)「**解決する**」＝その指摘を指示にして該当節を再生成し、自動再レビューでAIが解決を判定、(b)「**解決済み**」＝全カード共通の手動マーク（押すとカードが消える）。
3. **C. 執筆レイアウト固定** — 章・小見出しをスクロールすると全体がスクロールしてヘッダー・右側が消える。ヘッダー/ナビを固定し、章・小見出しと本文を各カラム独立にスクロールさせる。

A と「解決する」は**「指示を添えて本文をAIで再生成する」同じ処理**であり、土台を共通化する（指示の出どころが違うだけ：A はユーザーのコメント／解決する はその指摘文）。

## 決定事項（ブレインストーミングで確定）

- **A の指示欄は一回きり**（構成の「AIで修正」と同じ transient な作法。空なら従来どおり）。
- **「解決する」＝節ごと作り直し（①）**：指摘を指示にして本文を再生成。部分修正（②）はしない。
- **解決判定はAI（既存の再レビュー）に委ねる**：再生成は元々レビュアーを再実行し、レビュー画面が前回 vs 今回で「解決」を判定する。追加のAI呼び出しは設計しない。その指摘が再度出なければ解決、出続ければカードは残る。
- **「解決済み」は全カード共通の手動マーク**（`dismissedFindings` と同じ仕組みの別枠 `resolvedFindings`）。「対応不要(Ignore)」とは別枠。AI判定の補助・上書き。

## 背景・現状（実装前に確認済み）

- **本文再生成の経路**: 執筆画面 `handleGenerate(true)` → `startSectionDraft(project, chapter, section)`（`src/lib/translationClient.ts`、指示引数なし）→ `POST /api/generate-draft` → `draftWorkflow`。`draftWorkflow` はレビュアー各種（proofreader / citation-check / logic-check 等、`src/workflows/draft.ts`）を再実行し、`sectionAgentReports` を更新する。
- **プロンプト組み立て**: `draftStep`（`src/workflows/draft.ts:158`）が `renderTemplate(tpl.userPromptTemplate, {...})`（:174）＋ `systemPromptFinal`（:223）を作る。draft 系プロンプトには `{{instruction}}` スロットは無い。構成の refine 系プロンプト（`src/lib/samples.ts` の `{{instruction}}`）が指示注入の先例。
- **API 経由**: `POST /api/generate-draft` は受け取った body（`DraftWorkflowInput`）をそのまま `start(draftWorkflow, [body])` へ渡す。よって body に新フィールドを足せば自動で末端まで流れる。
- **レビューの指摘モデル**: 指摘には安定ID（`節key|agent|message|loc`）。`dismissedFindings: string[]`（対応不要）と `setFindingDismissed(id, on)`（`src/lib/storage.ts:513`）が既存。レビュー画面（`src/app/review/page.tsx`）は `FindingStatus="resolved"|"improved"|"open"|"clean"` を前回(`sectionAgentReportsPrev`) vs 今回で判定し、`dismissedSet` で対応不要を open から除外する。
- **執筆レイアウト**: `src/app/layout.tsx` は `<header className="topbar">` ＋ `<Nav />` ＋ `<main className="main">`。`.writer-shell`（`globals.css:419`）は `grid-template-columns: 340px 1fr`（左=章・小見出し `.toc`、右=本文）。現状 topbar/nav に sticky/fixed 指定はなく、ページ全体が縦スクロールするため章・小見出しを送るとヘッダー・上部メニュー・右側が画面外へ出る。

## 設計

### ① 共通土台：指示を本文再生成に注入する

- `DraftWorkflowInput`（`draft.ts:47`）に `instruction?: string` を追加。
- `draftStep`：`input.instruction?.trim()` があれば、`systemPromptFinal`（または userPrompt 末尾）に次のブロックを足す：
  「**【この節への修正指示】**\n{instruction}\n上記の指示を最優先で反映して本文を書き直すこと（指示に関係しない箇所は保持）。」
  指示が無ければ従来と完全に同じ（既存挙動不変）。
- `startSectionDraft(baseProject, chapter, section, instruction?)` に第4引数を追加し、`postJson("/api/generate-draft", { ...既存, instruction })` に載せる。API/ワークフローは body 透過なので追加改修不要。
- 呼び出し側（A の執筆画面／解決する のレビュー画面）は `instruction` を渡すだけ。再生成が終われば従来どおりレビュアーが再実行され、解決判定が更新される。

### A. 指示付きの本文再生成（執筆画面）

- 「本文を再生成」ボタンの近くに、任意の**一回きりの指示入力**（例: `<input>`「修正の指示（例: もっと具体例を / 説明を短く）」＋そのまま「本文を再生成」）。
- `handleGenerate(true)` を、指示欄が非空ならその値を `startSectionDraft(..., instruction)` に渡すよう変更。実行後に指示欄はクリア（transient）。空なら従来どおり。
- 旧本文は既存の再生成フローで「変更差分」（`bodyHistory`）に退避される（PR-A 既存）。手動編集で保護中(`locked`)の節は既存の確認ダイアログを踏襲。

### 解決する（レビューカード）

- 「**解決する**」ボタンは**1指摘単位**（その指摘 finding の行に付く。グループ表示でも個々の finding ごと）。押すと：
  1. その指摘が属する節（finding の安定ID `節key`＝`chapterId::sectionId` から chapter/section を特定）を、`instruction =` **その指摘の `message`**（必要なら severity/loc を添える）で**再生成**（① の経路）。
  2. 再生成に伴いレビュアーが再実行され、`sectionAgentReports` が更新。
  3. レビュー画面の既存判定で、その指摘が今回出なければ「解決」→ カードが消える。出続ければカードは残る（「まだ指摘あり」）。
- 実行中はスピナー／二重押下防止。複数節にまたがる一括解決は非スコープ（1カード＝1節の再生成）。
- 注意（① の帰結）：節全体が作り直されるため、同じ節の他の指摘にも影響し得る。これは①を選んだ設計上の割り切り。

### 解決済み（全カード共通の手動マーク）

- `Project` に `resolvedFindings?: string[]` を追加（`dismissedFindings` と同型）。`mergeDefaults` に補完を追加。
- `setFindingResolved(id: string, resolved: boolean): Project` を storage に追加（`setFindingDismissed` と同じ実装形）。
- レビュー画面：`resolvedSet` を作り、open 集合から `resolvedSet` の指摘を除外（＝カードが消える）。「解決済み」タブ/一覧から復帰（トグルオフ）できる。「対応不要(Ignore)」とは独立の別セット。
- 全カード（どのレビュアーの指摘でも）に「解決済み」トグルを表示。

### C. 執筆レイアウト固定（ヘッダー固定＋独立スクロール）

- **ヘッダー/ナビ固定**：`.topbar` と `.nav` を `position: sticky; top: 0; z-index`（`.nav` は topbar の直下に張り付く）。全ページ共通の改善（ヘッダーが常に見える）。
- **章・小見出しと本文を独立スクロール（執筆画面のみ）**：`.writer-shell` をビューポート高さ基準の固定高（`height: calc(100vh - <topbar+nav+余白>)`）にし、左カラム（`.toc`）と右カラム（本文）をそれぞれ `overflow-y: auto; min-height: 0;`（グリッド子がスクロールするため `min-height:0` が必要）。章・小見出しを送っても上部メニュー・右側は消えない。`.writer-shell` クラスは執筆画面専用なのでスコープは限定される。
- 狭幅（既存 `@media (max-width: 980px)` の1カラム）では独立スクロールを解除し従来の縦スクロールに戻す（モバイルで固定高が破綻しないように）。

## 非スコープ（今回やらない）

- 「解決する」の部分修正（②：差分プレビュー→箇所だけ修正）。①（節再生成）のみ。
- 「解決する」の複数節一括／全指摘一括解決。1カード＝1節。
- A の指示を節ごとに永続保存する形（今回は一回きり）。
- 解決判定の専用AI（既存の再レビュー突合を使う。新規の判定AI呼び出しはしない）。
- 「対応不要(Ignore)」の挙動変更（既存のまま。解決済みは別枠）。
- ヘッダー固定に伴う他ページの大幅レイアウト変更（sticky 化のみ。個別ページの作り込みはしない）。

## リグレッション・テスト計画（テストランナー無し：tsc/build/実機）

1. **① 指示注入（純粋/型）**: `instruction` 未指定時に `draftStep` のプロンプトが従来と一致（既存挙動不変）。指定時に指示ブロックが付く。`DraftWorkflowInput`/`startSectionDraft` の型整合。
2. **A 実機**: 執筆画面で指示を入れて「本文を再生成」→ 指示が反映された本文になる（ローカルにAIキーが無ければ、送信ペイロードに `instruction` が載ることを `read_network_requests` で確認。実生成は本番）。空欄なら従来どおり。旧本文が変更差分に退避。
3. **解決する 実機**: レビューカードの「解決する」→ 該当節が再生成され、再レビュー後にその指摘が消えれば解決（カード消滅）、残れば残存。送信ペイロードに `instruction`＝指摘文が載る。
4. **解決済み 実機**: 任意カードの「解決済み」→ カードが消え `resolvedFindings` に id が入る。復帰でトグルオフ。対応不要とは独立（片方が他方に影響しない）。リロードで永続。
5. **C 実機**: 執筆画面で章・小見出しを長くして左カラムをスクロール → ヘッダー/上部メニュー/右本文は固定のまま、左だけスクロール。右本文を長くして右だけスクロール。狭幅で1カラム縦スクロールに戻る。他ページのヘッダーが sticky で崩れない。
6. **回帰**: 通常の（指示なし）再生成・PR-A 手動編集/ロック・PR-B2 引用挿入・PR-B4 引用差し込み・対応不要(Ignore) が従来どおり。`npx tsc --noEmit` / `npx next build`。

## 触るファイル（見込み）

- Modify `src/workflows/draft.ts`（`DraftWorkflowInput.instruction`、`draftStep` の指示注入）
- Modify `src/lib/translationClient.ts`（`startSectionDraft` に `instruction?` 引数）
- Modify `src/lib/types.ts`（`Project.resolvedFindings?: string[]`）
- Modify `src/lib/storage.ts`（`resolvedFindings` の `mergeDefaults` 補完、`setFindingResolved`）
- Modify `src/app/writer/page.tsx`（A の指示入力欄＋`handleGenerate` への配線）
- Modify `src/app/review/page.tsx`（「解決する」ボタン＝節再生成呼び出し、「解決済み」トグル、`resolvedSet` で除外）
- Modify `src/app/globals.css`（`.topbar`/`.nav` の sticky、`.writer-shell`/`.toc`/右カラムの独立スクロール、狭幅の解除）
