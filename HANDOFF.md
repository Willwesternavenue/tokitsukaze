# アキカゼ出版AI — 引き継ぎドキュメント

最終更新: 2026-07-04 / 最新コミット: `10f29f7`

## これは何か

自費出版会社向けの **AI編集システム**（当初「聞き書き出版AI」→ 5ジャンル対応に育ち「アキカゼ出版AI」に改名）。
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
`genre / characters / storyBible / references / glossary / screenplayMeta / blogMeta / referenceWorkIds /
agentToggles / sectionAgentReports`。
- 参照ライブラリ本体は **グローバル** localStorage（`akikaze:library:v1`）。プロジェクトは `referenceWorkIds` で参照
- プロンプトも **グローバル**（`kikigaki:prompts:v1`）

### 5. クライアント↔API
- `src/lib/apiClient.ts` の `postJson` が非JSON応答（Vercelタイムアウトページ等）を人間可読エラーに変換
- `src/lib/ai.ts` の `generateJsonWithRetry` が parse 失敗時に最大2回リトライ（temperature 0.2）
- `src/lib/json.ts` の `safeJsonParse` がコードフェンス除去・JSON断片抽出

## 5ジャンルと専任エージェント

| ジャンル | 素材ラベル | 専任ナレッジ | 専任レビュアー |
|---|---|---|---|
| biography（聞き書き） | 取材メモ | 執筆メモリ | 校閲(事実確認) |
| novel（小説） | プロット素材 | 登場人物/相関図/StoryBible | キャラ整合/緊張感 |
| business（ビジネス書） | 取材・リサーチ素材 | 参考文献・用語集 | 校閲/論理構成/出典 |
| screenplay（脚本） | ログライン・素材 | 登場人物/相関図/設定 | キャラ/緊張感/フォーマット/尺 |
| blog（ブログ記事） | ネタ・キーワード | キーワード・ペルソナ | 校閲/SEO |

共通レビュアー: 校正 / 文体守護 / 整合性 / 読者体験。
参照ライブラリ選択時（全ジャンル）: 重複チェック / 一貫性チェック（過去作）。

## 画面一覧

- `/` 素材入力（ジャンルでラベル可変）
- `/outline` 構成案3案 → 「この案で調整する」
- `/outline/refine` **構成の調整**（全体AI改善 / 章ごとAI修正 / 手動編集）→ 小見出し生成 → writer
- `/writer` 執筆（左: 章・小見出しツリー + ＋追加 / 右: 本文 + 小見出し編集 + AI編集チーム診断）
- `/review` 診断集約ビュー
- `/staff` AIスタッフ（旧プロンプト管理。`/prompts` はここへ redirect）
- `/settings` プロジェクト設定 + JSON入出力 + ロードマップ
- ナレッジ: `/memory` `/characters` `/relations` `/bible` `/references` `/seo` `/library`

## 最近の実装（このセッション、新しい順）

1. **小見出しの個別編集**（`10f29f7`）: /writer で小見出しを手動編集/AI修正/追加/削除 → 本文生成
2. **構成の調整画面**（`935bb72`）: /outline/refine 追加。全体AI改善 + 章ごと修正 + 手動編集
3. **アキカゼ出版AI 改名 + 参照ライブラリ**（`d2b4753`）: 過去作品を作品カルテ化して踏襲/重複/矛盾チェック
4. ブログ / 脚本 / ビジネス書モード（`3604e49` / `49f66c5` / `8374d35`）
5. 人物相関図（`9850f5e`）、ナビ再構成（`979cefd`）、小説モード（`9829780`）、多役化 P2（`05a6814`）、WDK/Neon 基盤 P1（`b37efd2`）

## ストレージ設計判断（既に確定済み）

参照ライブラリの原本保存は **Google Drive / Supabase Bucket を採用しない**。
カルテは軽量なのでグローバル localStorage で共有、原本は抽出処理の間だけ扱い永続保存しない。
将来 全文RAG に進む場合のみ **Vercel Blob（原本）+ Neon pgvector（チャンク）**。理由は `HANDOFF` 下部の
`.claude/plans/cozy-wibbling-tiger.md`（最新プラン）とコミット `d2b4753` の本文に記録。

## 次にやる候補（ロードマップ）

- **実用書モード**（検討中。手順検証エージェント）
- **論文モード**（検討中。IMRaD + 日英翻訳 + 簡易査読）
- **全文RAG**（Phase B。Vercel Blob + Neon pgvector。過去作の逐語セリフ矛盾検出など）
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

- Anthropic prefill は Sonnet 4.6 で 400 → 使わない（system prompt で JSON 強制 + リトライ）
- `.env.local` 変更は dev サーバ再起動が必要
- Vercel body 制限 4.5MB → 参照ライブラリの大きい PDF は UI で注意喚起済み
- `mammoth`/`unpdf` の serverless 動作は要実機確認（デプロイ後 /library で docx を1つ試すのが確認手順）
- `/` 素材入力の interviewNotes 空チェックが全ジャンルに効く（ブログ等でも「取材メモが空」表示になる小さな癖・未修正）
