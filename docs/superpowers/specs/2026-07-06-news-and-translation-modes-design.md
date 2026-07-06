# ニュース記事モード + 翻訳書モード 設計書

日付: 2026-07-06 / 対象: アキカゼ出版AI（6・7番目のジャンル追加）

ユーザー要望:
1. ブログ記事モードをもとに **ニュース記事モード** を追加
2. **翻訳書モード** を新設 — 原文（Word/PDF）取り込み → 章分割 → エージェント翻訳 →
   対訳表・表記揺れチェック → GitHub風Diff対比 → 用語検索・一括置換などローカライズ支援
3. 翻訳エンジンは将来の **論文モード**（IMRaD・出典・簡易査読）へ流用できる設計にする
4. 言語は当面 日⇄英。将来 es/zh/ko/fr/de を追加できる形にしておく
5. 創作（フィクション）の翻訳にも対応する

## 方針

既存の GenreConfig 駆動アーキテクチャに完全に乗る（新ジャンル追加 = config + プロンプト +
専任エージェント。画面骨格 01素材→02構成→03執筆→04レビュー は固定）。

---

## 1. ニュース記事モード（genre: "news"）

ブログ記事モードの複製ではなく「報道の規律」を足した変種。

- **NewsMeta**: `outlet`（想定媒体）/ `newsType`（straight | explainer | feature | interview）/
  `angle`（切り口）/ `audience`（想定読者）/ `headlineDraft`（見出し案。AI提案・編集可）
- **構成3案の型**: 逆ピラミッド型（chronological）/ 解説・Q&A型（thematic）/ ルポ・特集型（narrative）
- **プロンプト**: `prompt-outline-news` / `prompt-sections-news` / `prompt-draft-news`
  （リード文=結論先行、5W1H、事実と論評の分離、出典の明示、伝聞表現の規律）
- **専任レビュアー**（AgentKey 追加）:
  - `headline-lead-check` 見出し・リード整合（見出し詐欺、リードの5W1H欠落、本文との乖離）
  - `neutrality-check` 中立性・両論併記（一方的な断定、ロード語、出典なき評価）
  - 既存 `fact-check` を news にも適用
- **ナレッジ**: `/references`（取材源・出典として流用）+ 執筆メモリ + 参照ライブラリ
- 素材入力画面に newsType / angle / outlet の簡易フィールドを追加（blog の対策キーワードと同パターン）

## 2. 翻訳書モード（genre: "translation"）

### データモデル

- **TranslationMeta**: `sourceLang` / `targetLang`（"en" | "ja"。将来言語追加を見込み string union を拡張）
  / `workType`（book | paper | fiction | article — 論文・創作対応の分岐点）/
  `stylePolicy`（ですます・である、直訳寄り/意訳寄り、敬称方針などの自由記述）/
  `sourceFilename?` / `sourceCharCount?`
- **TermPair（対訳表の1行）**: `source`（原語）/ `target`（確定訳語）/ `variants[]`（検出したい揺れ表記）/
  `notes` / `status`（confirmed | candidate）→ `Project.termPairs`
- **Section.sourceText?**: セグメントの原文（翻訳モードのみ）
- **SectionDraft.bodyHistory?**: `{ savedAt, body, note }[]`（最大10版。Diff比較の材料）

### パイプライン

1. **取り込み**（素材ステージ）: docx/pdf/txt/md を `/api/extract-source` にアップロード
   （抽出ロジックは ingest-reference から `src/lib/extractFile.ts` に切り出して共用）。
   またはテキスト貼り付け。
2. **章分割**: クライアント側の決定論的分割（第N章 / Chapter N / 数字見出しの正規表現 +
   見出しが無い場合は空行・文字数での分割）→ プレビューで確認 → 確定。
   章ごとに約2,400字前後・段落境界でセグメント化し、`Section.sourceText` に保持。
   確定時に OutlineProposal を**AIを使わず**組み立てて selectedOutline に設定
   （outlineProposals には sourceText を除いた軽量コピーを置く）→ /writer へ直行。
   ※ /writer の「小見出しを再生成」はセグメント破壊になるため翻訳モードでは非表示。
3. **翻訳**（執筆ステージ）: 既存 draftWorkflow をそのまま使用。`prompt-draft-translation` が
   `section.sourceText` を翻訳。`buildTranslationContext()` が対訳表（confirmed優先・上限80語）・
   stylePolicy・workType別規律（論文=術語厳密・引用/数式/図表参照・出典表記の保持、
   創作=声・リズム・敬称・意訳許容、実用書/記事=正確さと読みやすさ）を system prompt に注入。
   直前セグメント訳文の末尾（previousTail）を渡して文体接続を維持。
4. **自動レビュー**（AgentKey 追加。翻訳モードでは consistency-lite / reader-experience は走らせない）:
   - `omission-check` 訳抜け・過剰訳（原文と突き合わせ）
   - `terminology-check` 用語統一（対訳表と突き合わせ）
   - `orthography-check` 表記揺れ（カタカナ長音・漢字/かな・数字表記など）
   - 共通の proofreader / style-guardian は継続

### ローカライズ支援UI

- **/writer 拡張（翻訳モードのみ）**:
  - 表示タブ「対訳 / 訳文 / 変更差分」— 対訳=原文・訳文の左右対比、
    変更差分=bodyHistory と現行訳文の GitHub 風 Diff（自前 LCS 実装 `src/lib/diff.ts`、
    行単位 + 変更行内の文字単位ハイライト。依存追加なし）
  - 訳文のインライン編集（保存時に旧版を bodyHistory へ退避）
  - 再生成時も旧版を bodyHistory へ退避
  - 「対訳Wordを出力」= 原文/訳文の2列テーブル docx（`exportBilingualDocx`）
- **/terms（新ページ・対訳表）**:
  - TermPair の一覧・追加・編集・削除・candidate→confirmed 昇格
  - 「AIで用語を抽出」: 翻訳済みセグメントの原文・訳文ペアから候補抽出
    （`/api/extract-terms` → terms ワークフロー。ingest-reference と同じ同期 await 型）
  - 用語検索: 全セグメントの原文・訳文を横断検索（前後文脈つきヒット一覧）
  - 一括置換: 置換前プレビュー（節ごとのヒット表示）→ 全訳文へ適用（bodyHistory 退避つき）
  - 表記揺れスキャン: variants と確定訳語のミスマッチを決定論的に走査したレポート

### 論文モードへの布石

- workType="paper" が論文翻訳の入口（IMRaD知識や査読エージェントは論文モード側で追加）
- terminology / omission / orthography エージェントと対訳表・Diff 基盤はそのまま流用可能
- staffRegistry の plannedGenres の記述を更新（翻訳エンジン流用を明記）

## 3. 触るファイル

types.ts / genreConfig.ts / staffRegistry.ts / samples.ts / storage.ts /
workflows: draft.ts・agents/reviewers.ts・terms.ts（新）/
api: extract-source（新）・extract-terms（新）・ingest-reference（抽出共通化）/
lib: extractFile.ts（新）・diff.ts（新）・docx.ts /
app: page.tsx・writer/page.tsx・terms/page.tsx（新）/ HANDOFF.md

## 4. やらないこと（YAGNI）

- 多言語（es/zh/ko/fr/de）の実装 — 型とUIの拡張点だけ用意
- 原文ファイルの永続保存（既存方針どおり抽出時のみ扱う。localStorage にはテキストのみ）
- 翻訳メモリ（TM）・機械学習ベースの対訳アライメント
- 論文モード本体（IMRaD 構成生成・簡易査読エージェント）

## 5. 検証

`npx tsc --noEmit` + `npx next build` を通す。動作確認はニュース=構成案生成まで、
翻訳=貼り付け→分割→翻訳→対訳/Diff/用語置換の一連をローカルで手動確認（AIキー必要のため
ビルド検証を必須、実機確認は可能な範囲で）。
