# Development Notes

## セットアップ

```bash
cp .env.local.example .env.local  # AI キーを設定
npm install
npm run dev
```

`.env.local` の主要変数:

| Key | 用途 | 必須 |
|---|---|---|
| `AI_PROVIDER` | `anthropic` or `openai` | ◯ |
| `ANTHROPIC_API_KEY` | Anthropic 使用時 | Anthropic のみ |
| `OPENAI_API_KEY` | OpenAI 使用時 | OpenAI のみ |
| `DATABASE_URL` | Neon Postgres の接続 URL | 任意（P1では省略可） |

## アーキテクチャ (P1 時点)

```
Browser (React, App Router)
   ↓ POST /api/{outline|sections|draft|review}
API Route
   ↓ start(workflow, [input])
Workflow SDK (workflow, @workflow/next)
   ↓ "use step" 関数
step: 現行 generation ロジック (generateJsonWithRetry)
   ↓
Anthropic / OpenAI
```

- **workflow は "オーケストレータ"** のみ担当。sandbox で動くので副作用禁止。
- **step は full Node.js アクセス**。AI 呼び出しは全てここ。
- **runId** を最終レスポンスに含める。P2 以降 UI にリンクさせる予定。

### ディレクトリ

```
src/
  app/api/*/route.ts   ← 4 ルート。workflow.start() を呼ぶだけ
  workflows/           ← WDK ワークフロー本体
    outline.ts
    sections.ts
    draft.ts
    review.ts
    shared.ts          ← 共通ヘルパ (runAiStep)
  db/                  ← Neon + Drizzle
    schema.ts          ← projects / sections / agent_reports / prompt_templates
    client.ts          ← neon serverless driver
    queries.ts         ← DB 未設定時は no-op のガード付き
  lib/                 ← 既存の localStorage / AI クライアント
```

## Neon Postgres の準備

1. Vercel ダッシュボード → Project → Storage → Add → **Neon Postgres** を選択
2. 接続時に `DATABASE_URL` が自動で環境変数に注入される
3. ローカル用は Neon の branch URL を発行して `.env.local` に貼る
4. 初回だけ:
   ```bash
   npm run db:generate   # schema からマイグレーション SQL 作成
   npm run db:migrate    # DB へ適用
   ```

`DATABASE_URL` を設定しなくてもアプリは動作します（DB 書き込みは no-op になり、
既存の localStorage フローで完結）。**P1 の姿勢: DB があれば使う、なければ従来通り**。

## Workflow の開発

```bash
# workflow 実行の可視化ダッシュボード
npm run workflow:web

# CLI で run 一覧
npx workflow inspect runs

# 単一 run を検査
npx workflow inspect run <run_id>
```

## P1 で実装したこと

- Vercel Workflow SDK を導入 (`workflow`, `@workflow/next`, `@workflow/ai`)
- `next.config.mjs` を `withWorkflow` でラップ
- 4 API ルートを 1-step workflow でラップ (機能差分ゼロ)
- Neon Postgres + Drizzle schema (projects/sections/agent_reports/prompt_templates)
- `DATABASE_URL` があれば `draft` 生成時のみ sections テーブルに runId 付きで保存
- `.env.local.example` を更新、README（本ファイル）追加

## P1 でやっていないこと（後続フェーズ）

- P1.5 : AI Gateway 経由へ切替
- P2   : Reader Experience Reviewer / Proofreader / Style / Consistency の並列 step 化
- P3   : 小説専用 (Character 強化 / Plot Architect / Story Bible)
- P4   : Scene Builder / Fictionalization Advisor / Privacy Risk Checker
- P5   : 編集コマンドパレット
- P6   : 通しレビュー (章確定・全巻)
- P7   : 脚本 / ビジネス書 / 聞き書きへの横展開

## トラブルシューティング

### `'start' received an invalid workflow function`

`next.config.mjs` が `withWorkflow` でラップされていない、
または対象関数の 1 行目に `"use workflow"` がない。

### `[db] saveSectionDraft failed (ignored)`

`DATABASE_URL` は設定されているが Neon に到達できない状態。
アプリの動作には影響しない (localStorage で継続動作)。
