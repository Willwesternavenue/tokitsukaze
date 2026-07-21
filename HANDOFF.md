# アキカゼ出版AI — 引き継ぎドキュメント

最終更新: 2026-07-21

---

## 🔴 現在進行中（2026-07-21）: 論文モードの「引用・脚注・参考文献」アーク

論文モードの引用機能を段階実装中。**本番 main には PR #1〜#8 が全てマージ済み**（引用スタイル選択・参考文献リストWord出力・節への文献紐付け・本文の手動編集など）。

### 設計の全体像（ブレインストーミング結論）
- Q1=**C**（節への文献紐付け＋手動マーカー挿入の両方）、Q2=**A**（手動編集は初回のみ自動保護）。
- 引用は **HINT型**、スコープは**論文優先**。
- 設計書: [`docs/superpowers/specs/2026-07-20-body-editing-and-section-citations-design.md`](docs/superpowers/specs/2026-07-20-body-editing-and-section-citations-design.md)（本文編集＋節引用）

### 完了（main マージ済み）
- **PR-B1**（#7）: `Section.referenceIds` で節に文献紐付け → `buildPaperContext(project, section)` で優先引用注入（孤児ID除外）＋ /writer チェックリスト。
- **PR-A**（#8）: 本文の手動編集を全ジャンルに開放。`saveManualBodyEdit(…, isManualEdit)`（=非翻訳のみ自動保護＋履歴圧縮）／`SectionDraft.bodyEditedAt`・`lockReason`／未保存切替の確認／非翻訳の変更差分／**翻訳フロー不変**。`finishSectionDraft` の再生成前退避を全ジャンルに拡張済み。

### ▶ 次にやる: PR-B2（本文エディタの引用挿入ピッカー）— **計画完成・未実装**
- **計画書**: [`docs/superpowers/plans/2026-07-21-pr-b2-citation-picker.md`](docs/superpowers/plans/2026-07-21-pr-b2-citation-picker.md)（レビュー2巡反映済み・実装可）
- **ブランチ**: `claude/pr-b2-citation-picker`（push済み・docs 3コミットのみ、コードは未着手）。**別スレッドはこのブランチを checkout して再開する**（main には計画がまだ無い）。
- **中身**: 論文の本文エディタ（PR-A の textarea）に「引用を挿入 ▾」ピッカー。`authorYearMarker(ref)` をカーソル位置へ挿入（インライン式・スタイル非依存）。selectionStart 保持（onSelect＋onMouseDown preventDefault）・キャレット復元は `useLayoutEffect`+`pendingCaretRef`・IMEガード・外側クリック/Escで閉じる・節紐付け文献を★で上に。全て文字列アンカー化・裏取り済み。
- **再開手順**: `git checkout claude/pr-b2-citation-picker` → superpowers:subagent-driven-development で計画を Task 1（実装）→ Task 2（コントローラのブラウザ検証）実行 → 最終レビュー（opus）→ PR。

### その次: PR-B3（脚注モード）— **設計書 未作成**
Word の「Footnotes/Endnotes」相当。シカゴ ノート式・和文脚注（人文/和文誌で標準）。PR-B2 とは独立（共有点は本文の正準マーカーのみ）。**設計書から起こす**。実装前調査で押さえた事実:
1. `docx@8.5` は脚注対応（`FootnoteReferenceRun` 関数エクスポート済み）。`Document` は `sections` のみ渡しており `footnotes` は同列トップレベルオプション＝**キー追加でOK**（ただし本文レンダ中に脚注エントリ収集＋id採番の配線が要る）。
2. 参考文献欄は `exportProjectDocx`・`exportPreprintDocx` に**あり**、`exportSectionDocx`（単一節）には**無し**。
3. `citationStyle = "apa"|"ieee"|"sist02"|"mla"`（既定apa、`PaperMeta.citationStyle?` optional、既存 localStorage は undefined 多く apa フォールバック）。union 拡張で既存データ無傷・マイグレ不要。
- 波及範囲: `citationStyle`型・`citation.ts`フォーマッタ・`docx.ts`出力分岐・`citation-check`。Word出力の回帰は「4スタイル × 3出力」で別規模。

### 作業の進め方（このアークで確立した作法）
- **skills**: brainstorming → writing-plans → subagent-driven-development（`.claude/plugins/.../superpowers/6.0.3/skills/subagent-driven-development/scripts/` の `task-brief`・`review-package` を使用）。進捗 ledger は `.superpowers/sdd/progress.md`（git非追跡）。
- **モデル**: 自明な型追加=haiku、統合=sonnet、最終全ブランチレビュー=opus。
- **ユーザーは全計画を精査するレビュアー**。文字列アンカー一意性・非スコープ明記・翻訳フロー不変・selectionStart等を毎回鋭く指摘する。**計画は実装前にユーザーレビューを通すこと**。
- **検証**: テストランナー無し → `npx tsc --noEmit`＋`npx next build`＋ブラウザ実機（＋純粋ロジックは scratchpad node）。**ビルドは Node 24 必須**（`source ~/.nvm/nvm.sh && nvm use 24.15.0` 前置。v18だと落ちる）。
- **本番未検証（ローカルにAIキー無し）**: 要旨/予稿/文献カルテのAI実生成・引用の実生成・本文再生成の履歴復元。マージ後に本番で要確認。

---

## これは何か

自費出版会社向けの **AI編集システム**（当初「聞き書き出版AI」→ 8ジャンル対応に育ち「アキカゼ出版AI」に改名）。
取材メモ／プロット等の素材から、構成案 → 小見出し → 本文を生成し、複数の AI エージェントが
校正・整合性・読者体験などをレビューする。デモ／商談用。

- **本番URL**: https://akikaze.vercel.app （Vercel Pro、東京リージョン hnd1）
- **リポジトリ**: https://github.com/Willwesternavenue/tokitsukaze （branch: main）
- **ローカル**: `/Users/will/tokitsukaze`
- git user: westernavenue / tachiiri@westernavenu.com

## 技術スタック

- Next.js 14.2.15（App Router）+ TypeScript。Node 18 ローカル / Vercel は Node 20+
- **Vercel Workflow SDK (WDK)**: AI 呼び出しのオーケストレーション（`workflow` / `@workflow/next` / `@workflow/ai`）
- **Neon Postgres + Drizzle**: 任意。draft/agent_reports の永続化のみ。未設定でも動く（localStorage 主）
- AI: OpenAI / Anthropic を `AI_PROVIDER` で切替（現状 Anthropic `claude-sonnet-4-6`）
- ドキュメント: 出力=`docx`、取り込み=`mammoth`(docx)/`unpdf`(pdf)
- 状態: **localStorage が主**、Neon は従。プロンプト/参照ライブラリはグローバル localStorage

## 環境変数（Vercel + ローカル .env.local）

| 変数 | 用途 |
|---|---|
| `AI_PROVIDER` | `anthropic` |
| `ANTHROPIC_API_KEY` | Anthropic キー（Vercelでは Sensitive → `vercel env pull` では空で来る。ローカルは手動記入） |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-6`（`claude-sonnet-4-5` エイリアスは無効なので注意） |
| `POSTGRES_URL` 等 | Neon（Vercel Marketplace 統合が自動注入。`src/db/client.ts` が複数名を先勝ちで解決） |

- `vercel.json`: API ルートの `maxDuration` を 180s に設定済み
- Neon マイグレーションは `drizzle/0000_gray_scream.sql` を Neon SQL Editor に貼って適用済み
  （`@neondatabase/serverless` は websocket 前提で drizzle-kit migrate が不安定なため手動適用した経緯あり）

## アーキテクチャの背骨（ここを理解すれば全部わかる）

### 1. GenreConfig 駆動（`src/lib/genreConfig.ts`）
5ジャンルは **config のプリセット**。ナビ骨格（01素材→02構成→03執筆→04レビュー）は固定で、
ラベル・ナレッジ項目・使うプロンプトを config が差し替える。新ジャンル追加 = config + プロンプト + 専任エージェント。
- `pipelinePrompts: { outline, sections, draft }` — ジャンル別のプロンプト id
- `outlineTypeLabels` — 構成案3案の型ラベル
- `knowledge[]` — ナレッジ▾ の中身
- `buildScreenplayExtraContext()` — 名前は歴史的経緯だが**全ジャンル共通の extraContext ディスパッチャ**（脚本=尺、ブログ=SEO）

### 2. AIスタッフ / ナレッジ / ルールブックの3分類（`src/lib/staffRegistry.ts`）
- **AIスタッフ** = 実行される役割（プロンプト id を役割として分類）。`agentKey` 持ちは本文生成後の自動レビュアー
- **ナレッジ** = 参照される材料（登場人物/相関図/StoryBible/参考文献/SEO/参照ライブラリ）
- **ルールブック** = 注入される編集方針（校正・編集ルール）
- `/staff` 画面がこのレジストリを描画。ジャンルフィルタ + 有効/無効トグル

### 3. WDK ワークフロー（`src/workflows/`）
`"use workflow"` = オーケストレータ（sandbox・副作用禁止）、`"use step"` = 実処理（full Node）。
- `outline.ts` / `sections.ts` / `draft.ts` / `review.ts` — 4本柱
- `draft.ts` が中心: 本文生成 → **ジャンル別 + 参照ライブラリのエージェントを並列実行**（Promise.all）→ DB 永続化
  - `agentToggles` で無効化されたレビュアーはスキップ（`/staff` のトグル）
  - `buildNovelContext` / `buildBusinessContext` / `buildScreenplayContext` / `buildBlogContext` / `buildReferenceContext`
    で system prompt にジャンル/参照コンテキストを注入
- `relations.ts`（相関図抽出）/ `reference.ts`（作品カルテ map-reduce）/ `refineOutline.ts`（構成調整 whole/chapter/section）
- `agents/reviewers.ts` — 全レビュアーの AgentDef + step。`runReviewer` 共通ヘルパ + `AgentContext`

### 4. データ（`src/lib/types.ts` の `Project`）
localStorage に Project 配列。ジャンル別フィールドは optional（後方互換は `mergeDefaults` が補完）:
`genre / characters / storyBible / references / glossary / screenplayMeta / blogMeta / newsMeta /
translationMeta / paperMeta / referenceWorkIds / agentToggles / sectionAgentReports`。
- 参照ライブラリ本体は **グローバル** localStorage（`akikaze:library:v1`）。プロジェクトは `referenceWorkIds` で参照
- プロンプトも **グローバル**（`kikigaki:prompts:v1`）

### 5. クライアント↔API
- `src/lib/apiClient.ts` の `postJson` が非JSON応答（Vercelタイムアウトページ等）を人間可読エラーに変換
- `src/lib/ai.ts` の `generateJsonWithRetry` が parse 失敗時に最大2回リトライ（temperature 0.2）
- `src/lib/json.ts` の `safeJsonParse` がコードフェンス除去・JSON断片抽出

## 8ジャンルと専任エージェント

| ジャンル | 素材ラベル | 専任ナレッジ | 専任レビュアー |
|---|---|---|---|
| biography（聞き書き） | 取材メモ | 執筆メモリ | 校閲(事実確認) |
| novel（小説） | プロット素材 | 登場人物/相関図/StoryBible | キャラ整合/緊張感 |
| business（ビジネス書） | 取材・リサーチ素材 | 参考文献・用語集 | 校閲/論理構成/出典 |
| screenplay（脚本） | ログライン・素材 | 登場人物/相関図/設定 | キャラ/緊張感/フォーマット/尺 |
| blog（ブログ記事） | ネタ・キーワード | キーワード・ペルソナ | 校閲/SEO |
| news（ニュース記事） | 取材素材・一次情報 | 取材源・出典(/references流用) | 校閲/見出し・リード整合/中立性・両論 |
| translation（翻訳書） | 原文(docx/pdf/貼付) | 対訳表・用語(/terms) | 訳抜け/用語統一/表記揺れ |
| paper（論文） | 研究素材 | 参考文献・文献カルテ(/references) + 要旨・予稿 | 簡易査読/論理構成/出典/校閲・本文内整合 |

共通レビュアー: 校正 / 文体守護 / 整合性 / 読者体験（翻訳書では整合性・読者体験はスキップ）。
参照ライブラリ選択時（全ジャンル）: 重複チェック / 一貫性チェック（過去作）。
論文の引用安全ルール: 引用マーカー〔著者, 年〕は references 登録文献のみ。無ければ〔要出典〕（架空文献の生成禁止）。

### 引用・参考文献の体裁（2026-07-19 追加）

`src/lib/citation.ts`（純粋関数・AI不使用）に集約。`PaperMeta.citationStyle`（`apa`/`ieee`/`sist02`/`mla`、
未設定は `apa`＝従来の〔著者, 年〕互換）で切替。UI は `/`（論文仕様パネル）のセレクタ。
- **生成時**は全スタイル共通で本文に著者・年マーカー〔著者, 年〕を書かせる（`authorYearMarker`）。
  `buildPaperContext` が各登録文献に **正確なマーカーを付記**して「これをそのままコピーせよ」と指示するため、
  後段の置換キーとして厳密一致で使える。引用安全ルールと `citation-check` の突合は形式非依存で成立（レビューは変換前に走る）。
- **Word出力時**（`exportProjectDocx`・論文のみ）: `applyInTextCitations` で本文マーカーをスタイル変換
  （IEEE=出現順に決定論採番して [n]／MLA=年を落とし〔著者〕／APA・SIST02=そのまま）、末尾に `buildBibliography` で
  参考文献リストを整形出力。**番号はAI任せにせず出現順で採番**（未引用文献は登録順で後置）。
  マッチしないマーカーは改変しない（データ欠損回避）＝最悪でも本文は〔著者, 年〕のまま、一覧は常に正しい。
- 単一セクションのWord出力（`exportSectionDocx`）は採番が全文依存のため変換しない（著者・年マーカーのまま）。

### 脚本モードのプロ向け機能（2026-07-07 追加）

`src/lib/screenplay.ts` にすべて決定論的（AI不使用）な解析・変換を集約:
- **本文パーサ** `parseScreenplayBody`: 柱（○始まり）/ ト書き（全角空白始まり）/ 話者行＋「」行を分類。
  実測尺・キャラ分析・Fountain出力の共通基盤
- **/board シーンボード・香盤表**（脚本のみ・ナレッジから）: シーンカード俯瞰＋章内並べ替え（↑↓、
  `moveSectionInChapter`）＋キャラ/ロケ/INT-EXT/時間帯フィルタ、作品サマリ（INT/EXT・昼夜・ロケ数・尺）、
  **香盤表CSV**（`buildBreakdownCsv`）、**キャラ出番・台詞バランス**（出番数・セリフ行/字数・台詞シェア・
  出番の空白区間警告・話者の未登録検出）
- **Fountainエクスポート** `buildFountain`（/writer と /board）: Final Draft / Highland 等に読み込める。
  日本語話者は @名前 の強制キャラクター記法。未執筆シーンは `= 概要` のシノプシス
- **実測尺** `measureRuntime`: セリフ≈320字/分＋ト書き≈450字/分で本文から換算。/writer ゲージに
  「（実測 n分）」、/board カードに想定尺との乖離バッジ（±40%=warn、2倍/半分=error。尺チェックエージェントと同閾値）

### 翻訳書モードの特記事項

- 構成はAIで作らない: 原文取り込み（`/api/extract-source`）→ クライアント側で章分割
  （`src/lib/sourceSplit.ts`、見出し正規表現＋段落境界の決定論的分割）→ OutlineProposal を直接組み立て。
  各セグメントの原文は `Section.sourceText` に保持
- 翻訳は既存 draftWorkflow に乗る（`prompt-draft-translation` + `buildTranslationContext`。
  対訳表 `Project.termPairs`・文体方針・原文種別 workType=book/paper/fiction/article で規律切替）。
  **論文の翻訳は workType="paper" でこのエンジンに乗る**（論文モード本体は執筆専念）
- `/writer` の POST 時は `slimProjectForDraft` で他セグメントの sourceText と bodyHistory を落とす
  （4.5MB body制限とプロンプト肥大の対策）
- `/terms` = ローカライズ作業台（対訳表CRUD・AI用語抽出 `/api/extract-terms`・用語検索・
  一括置換・表記揺れスキャン）。置換・編集・再翻訳は旧訳文を `SectionDraft.bodyHistory` に退避（最大10版）し、
  `/writer` の「変更差分」タブで自前LCS Diff（`src/lib/diff.ts`）でGitHub風に比較できる
- 対訳Word出力: `exportBilingualDocx`（原文/訳文の2列テーブル）
- 言語は現状 日⇄英（`LangCode`）。追加時は types.ts の `LangCode` と genreConfig の `LANGUAGE_OPTIONS` に足す
- **原文消失ガード**: sourceText は selectedOutline にしか無いため、`storage.ts` の
  `preserveSourceText` が selectOutline / replaceSelectedOutline で旧構成から原文を引き継ぐ。
  UI側も翻訳モードでは /outline 表示専用・/outline/refine 無効・小見出しのAI修正非表示
- **一括翻訳**: /writer「未翻訳をすべて翻訳」＋章ごとの▶ボタン（順次実行・失敗スキップ・中断・
  再実行で再開）。共通ヘルパは `src/lib/translationClient.ts`（`generateSectionDraft` を
  /writer と /terms が共用）。左ペインに翻訳進捗ゲージ
- **/terms の品質運用**: 決定論的QAスキャン（数値転記・段落数・文字数比率）、
  用語の適用チェック（確定訳語が未適用のセグメント検出→一括再翻訳）、対訳表のCSV入出力
- **グローバル対訳表（2層）**: `akikaze:termsets:v1`（`TermSet[]`）に本体、`Project.termSetIds` で参照
  （参照ライブラリと同パターン）。`effectiveTermPairs(project)` が参照セット＋固有をマージ（同一原語は
  固有優先）。実効表を `slimProjectForDraft` が termPairs に載せて翻訳APIへ送るためサーバ側は無改修。
  /terms のスキャン（表記揺れ・適用チェック・AI抽出の既知判定）も実効表を使う。
  UI: /terms「グローバル対訳表（参照）」パネルで参照ON/OFF・確定語からセット作成・固有へ取り込み・削除。
  シリーズ物と論文モードの分野術語集の使い回しが狙い

## 画面一覧

- `/` 素材入力（ジャンルでラベル可変）
- `/outline` 構成案3案 → 「この案で調整する」
- `/outline/refine` **構成の調整**（全体AI改善 / 章ごとAI修正 / 手動編集）→ 小見出し生成 → writer
- `/writer` 執筆（左: 章・小見出しツリー + ＋追加 / 右: 本文 + 小見出し編集 + AI編集チーム診断）
- `/review` 診断集約ビュー
- `/staff` AIスタッフ（旧プロンプト管理。`/prompts` はここへ redirect）
- `/settings` プロジェクト設定 + JSON入出力 + ロードマップ
- ナレッジ: `/memory` `/characters` `/relations` `/bible` `/references` `/seo` `/terms` `/board` `/library`

## 最近の実装（新しい順）

### 2026-07-19 セッション（本番反映済み・全て main）
- **引用・参考文献の体裁選択 + 参考文献リストのWord出力**（`src/lib/citation.ts`）: `PaperMeta.citationStyle`
  （APA/IEEE/SIST02/MLA、未設定=apa互換）。`exportProjectDocx` 末尾に参考文献リスト（ぶら下げインデント）、
  番号式（IEEE）は出現順で決定論採番し本文マーカーも `[n]` に変換、MLAは年を落とす。上の
  「引用・参考文献の体裁」節を参照。← 下の★最優先タスクを実装したもの
- **ニュース記事モード + 翻訳書モード**を本番投入（news / translation。別ブランチにあった実装を統合）
- **脚本プロ5機能**: `src/lib/screenplay.ts`（Fountain出力 `buildFountain` / シーンボード `/board` /
  香盤表CSV `buildBreakdownCsv` / 実測尺 `measureRuntime` / キャラ出番分析）
- **グローバル対訳表**（`akikaze:termsets:v1` + `Project.termSetIds`、`effectiveTermPairs` でマージ）
- **合言葉ゲート**: `src/middleware.ts` + `src/lib/gate.ts`。env `STAFF_PASSCODE`/`GUEST_PASSCODE`/`GATE_SECRET`
  未設定なら無効（＝公開）。Cookie 90日。**本番はまだenv未設定＝公開中**
- **論文モード**を本番統合＋大幅強化:
  - 生成の**再開耐性**: 本文生成を runId即返し→ポーリングに統一（`pollRun`/`startSectionDraft`/`finishSectionDraft`、
    `akikaze:pendingRuns:v1` で復帰）。タブ切替・移動・リロード・300s制限に強い
  - **レビュー重要度トリアージ**（/review「重要度順」タブ）＋**指摘のIgnore**（`Project.dismissedFindings`）
  - **節数肥大バグ修正**: `slimProjectForDraft` を全モードで軽量化（他節本文を先頭要約に・診断結果を送らない）。
    論文で26節以降に生成が連発失敗していた主因
  - **Word出力の整備**: 作業メモ抜きのクリーン原稿（`includeNotes`）/「メモ付きWord」ボタン/
    Markdown整形（見出し・箇条書き・太字・**表→Word表**）/ 見出し二重化の除去（`stripLeadingDuplicateHeading`）/
    論文ラベル修正（著者・第N章なし）
  - **要旨・予稿**: `PaperMeta.abstract`/`preprint`。`prompt-abstract-paper`/`prompt-preprint-paper`、
    `src/workflows/paperOutput.ts` + `/api/generate-abstract`・`/api/generate-preprint`、
    `src/lib/paperClient.ts`（各節抜粋だけ送る）。素材画面「要旨・予稿」パネル、`exportPreprintDocx`
  - **文献カルテ**: `/references` を論文用に格上げ（`Reference.card` = 目的/手法/結果/貢献/限界/差分、
    PDF取込 `/api/extract-reference-card`）。論文では fiction 参照ライブラリを外す

0. **論文モード**（2026-07-13）: paper（IMRaD/AI・情報系/総説/人文社会の構成分岐、簡易査読、
   引用安全ルール、fact-check は「校閲・本文内整合」に表示名切替）。
   設計書: `docs/superpowers/specs/2026-07-13-paper-mode-design.md`
2. **ニュース記事モード + 翻訳書モード**（2026-07-06）: news（見出し・リード整合/中立性エージェント、
   newsMeta）と translation（原文取り込み→章分割→翻訳→対訳/Diff/用語/一括置換。上の特記事項参照）。
   設計書: `docs/superpowers/specs/2026-07-06-news-and-translation-modes-design.md`
3. **小見出しの個別編集**（`10f29f7`）: /writer で小見出しを手動編集/AI修正/追加/削除 → 本文生成
4. **構成の調整画面**（`935bb72`）: /outline/refine 追加。全体AI改善 + 章ごと修正 + 手動編集
5. **アキカゼ出版AI 改名 + 参照ライブラリ**（`d2b4753`）: 過去作品を作品カルテ化して踏襲/重複/矛盾チェック
6. ブログ / 脚本 / ビジネス書モード（`3604e49` / `49f66c5` / `8374d35`）
7. 人物相関図（`9850f5e`）、ナビ再構成（`979cefd`）、小説モード（`9829780`）、多役化 P2（`05a6814`）、WDK/Neon 基盤 P1（`b37efd2`）

## ストレージ設計判断（既に確定済み）

参照ライブラリの原本保存は **Google Drive / Supabase Bucket を採用しない**。
カルテは軽量なのでグローバル localStorage で共有、原本は抽出処理の間だけ扱い永続保存しない。
将来 全文RAG に進む場合のみ **Vercel Blob（原本）+ Neon pgvector（チャンク）**。理由は `HANDOFF` 下部の
`.claude/plans/cozy-wibbling-tiger.md`（最新プラン）とコミット `d2b4753` の本文に記録。

## 次にやる候補（ロードマップ）

### ✅ 完了: 参考文献・引用・出典の整備（論文モード、2026-07-19 実装）
`src/lib/citation.ts` に実装済み（上の「引用・参考文献の体裁」節と「最近の実装」参照）。
- `PaperMeta.citationStyle`（`apa`/`ieee`/`sist02`/`mla`、未設定=apa互換）＋ `/` にセレクタ
- `exportProjectDocx`（本編）と `exportPreprintDocx`（予稿）両方の末尾に参考文献リスト（ぶら下げインデント）。
  番号式（IEEE）は出現順で決定論採番、本文マーカーも `[n]` に変換（AIに採番させない）。MLAは年を落とす。
- 生成時は全スタイル共通で著者年マーカーを書かせ、`buildPaperContext` が各文献に正確なマーカーを付記して
  そのままコピーさせる（＝後段の厳密一致置換キー）。引用安全ルール・`citation-check` は無改修で成立。
- **文献の実在確認はしない方針を維持**。
- 残タスク候補: `Reference` への `doi?`/`pages?` 追加、バンクーバー（上付き番号）追加、学会別カスタム書式は
  必要になれば。番号式の本文 `[n]` 変換は「AIが付記マーカーを正確にコピーする」前提（ズレると変換されず
  〔著者, 年〕のまま残る安全設計）＝本番のAI生成で一度精度確認を。

### その他
- **実用書モード**（検討中。手順検証エージェント）
- **予稿の分量調整 / LaTeX出力**（arXiv・国際学会向け。予稿はドラフト、LaTeXテンプレへ流し込む運用）
- **投稿種別で最初から短く生成**（②-B。PaperMetaに投稿種別→章数・節分量を切替）
- **研究素材そのもののアップロード**（案A。`/api/extract-source` 流用で研究素材欄に追記）
- **全文RAG**（Phase B。Vercel Blob + Neon pgvector）
- P6 通しレビュー（`/review` の「全体レビューを実行」は現状 disabled）
- Neon への参照ライブラリ mirror（別端末同期が要るとき。今は JSON エクスポートで移行）

## 開発コマンド

```bash
npm install
npm run dev                 # ローカル開発
npx tsc --noEmit            # 型チェック
npx next build              # ビルド確認（コミット前に必須でやってきた）
npm run db:generate/migrate # Drizzle（migrate は不安定。SQL手動適用の運用）
npx workflow web            # WDK 実行の可視化
```

- コミット前に必ず `tsc --noEmit` と `next build` を通してから push、が本セッションの運用
- コミットは `git -c user.name="Will" -c user.email="tachiiri@westernavenu.com"` で作成
- 末尾に `Co-Authored-By: Claude ...`

## ハマりどころ（既知）

- **Node版**: このマシンの Claude Desktop は起動時PATHをキャッシュし、しばしば v18 で走る。
  `next build`/dev が `Unexpected token 'with'` や `@swc/core: Failed to load native binding` で落ちたら
  node が古いサイン。**v24.15.0 で通る**（`nvm alias default` は 24 済み。ビルドは
  `source ~/.nvm/nvm.sh && nvm use 24.15.0` を前置）。`.claude/launch.json`（gitignore）は
  v24 の絶対パス直指定にしてある。詳細はメモリ `desktop-node-version-path`
- **合言葉ゲート**: env未設定なら無効＝本番は公開中。閉じるなら Vercel に
  `STAFF_PASSCODE`/`GUEST_PASSCODE`/`GATE_SECRET` を設定して再デプロイ
- **AI生成のローカル検証不可**: ローカルに ANTHROPIC/OPENAI キーが無いため、実生成E2Eは未実施が多い。
  プラミング（runId返却・pending保存・docx中身）は検証済み。**本番で要確認**（特に要旨/予稿/文献カルテ抽出）
- **ブラウザ検証の実docx確認手法**: `URL.createObjectURL` をフックしてBlob捕捉→ZIP手動パース→
  `deflate-raw` で `word/document.xml` を展開して文字列検査（このセッションで多用）
- Anthropic prefill は Sonnet 4.6 で 400 → 使わない（system prompt で JSON 強制 + リトライ）
- `.env.local` 変更は dev サーバ再起動が必要
- Vercel body 制限 4.5MB → 本文生成は `slimProjectForDraft` で軽量化（全モード）。論文で節が増えても頭打ち
- `mammoth`/`unpdf` の serverless 動作は要実機確認
- `/` 素材入力の interviewNotes 空チェックが全ジャンルに効く（小さな癖・未修正）
