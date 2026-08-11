# 脚本モード 絵コンテ（静止画）生成 — 設計書（MVP）

- 日付: 2026-08-11
- 対象: akikaze-publishing-ai（tokitsukaze）／脚本（screenplay）モードのみ
- ステータス: 設計確定（実装計画の起票前）

## 目的とゴール

脚本の各シーンから、シネマティックな静止画（絵コンテ）を生成し、シーンに紐づけて保存・表示する。
狙いは「まず動くもの体験」＝**1シーン=1枚が出て、脚本に紐づいて残る最小ループ**を通すこと。将来の「AIスタジオ（動画生成）」への布石だが、**動画は本機能のスコープ外**（完全に別プロダクトとして切り離す）。

### 成功基準（MVP）
- 脚本モードの writer で、シーンごとに「絵コンテ生成」ボタンを押すと数秒で1枚が生成・表示される。
- 生成画像は Vercel Blob に保存され、プロジェクトには URL のみが残る（localStorage を肥大させない）。
- リロード後もシーンにサムネが表示される。再生成できる。
- 生成失敗時は明確なエラーが出る（サイレント失敗にしない）。

## 確定した意思決定

| 項目 | 決定 | 理由 |
|---|---|---|
| 目的/範囲 | まず動くもの体験（MVP優先） | ユーザー選択。YAGNIで最小ループ |
| 生成単位 | 1シーン（=1 Section）に1枚 | `Section` が既に `sceneMeta` を持ちシーン=セクション |
| 画像モデル | **Nano Banana（Gemini 3.1 Flash Image）** | 参照画像/指示追従による一貫性が強く、映像化への布石。~$0.067/枚（この規模ではコスト誤差） |
| 一貫性 | **②テキスト一貫性**（キャラ設定を毎プロンプトに文章注入） | UI/保存を増やさずほぼ無償で効く。参照画像(③)はv2 |
| 保存先 | **Vercel Blob**（URLのみ localStorage） | 画像はサイズ大でlocalStorage(~5MB)を壊しやすい。過去に「保存できず消えた」事例あり。メディア基盤の第一歩 |
| 画スタイル | **シネマティックな静止画（カラー・映画のワンシーン風）** 1種類固定 | 見栄え優先・提案物/AIスタジオに繋がる |
| 一括生成 | v1では入れない（シーン単位で1枚ずつ） | 枚数×秒×コストの暴発を避ける。最小 |
| 生成の回し方 | 軽量な**同期APIルート**（既存の重いWorkflowは使わない） | 画像は数秒。非同期ジョブ/ポーリング/DB永続は過剰 |

## アーキテクチャ

```
[writer UI: シーンの「絵コンテ生成」ボタン]
        │  POST /api/generate-storyboard { project一部, chapterId, sectionId }
        ▼
[/api/generate-storyboard] (Node runtime, 同期)
   1. buildStoryboardPrompt(project, section)   ← 純関数・AI不要
   2. generateStoryboardImage(prompt)           ← imageGen.ts（Nano Banana via AI Gateway）
   3. Vercel Blob へ put（public・ランダムパス）  ← @vercel/blob
   4. return { url, prompt, model, generatedAt }
        │
        ▼
[client] 返却URLを Section.storyboard に保存（既存storageパターン）
```

- 既存の `src/workflows/*`（draftWorkflow / persistAllStep / workflow-status）とは**独立**。相乗りしない。
- 既存の `src/lib/ai.ts`（テキスト専用）には**手を入れない**。画像は別層に分離。

## コンポーネント（単位と責務）

### 1. データモデル（`src/lib/types.ts`）
```ts
export type Storyboard = {
  url: string;         // Vercel Blob の公開URL
  prompt: string;      // 生成に使ったプロンプト（再現/デバッグ用）
  model: string;       // 例: "gemini-3.1-flash-image"
  generatedAt: string; // ISO
};
// Section に追加:
//   storyboard?: Storyboard
```
- 1シーン1枚（配列にしない＝MVP）。再生成は上書き。

### 2. プロンプト構築（`src/lib/storyboardPrompt.ts` — 新規・純関数）
`buildStoryboardPrompt(project: Project, section: Section): string`
- 素材（すべて `?.` ガード。空シーンでも壊れない。`buildScreenplayContext` と同方針）:
  - `section.sceneMeta`: `intExt` / `location` / `timeOfDay` / `purpose` / `presentCharacters`
  - `section.` 本文を `parseScreenplayBody` でパースし、**action（ト書き）行を決定的に連結・字数上限で切り詰め**て画の内容にする（AI呼び出しはしない。要約AIではなく単純な圧縮）
  - **②一貫性注入**: `presentCharacters` に一致する `ReferenceCharacterCard`（`project.referenceWorks[].characters` 由来）の `facts` から外見/設定の記述を各キャラぶん付加
  - **固定スタイル接尾辞**: "cinematic film still, color, dramatic lighting, cohesive art direction"（実装時に微調整可・定数化）
- 出力プロンプトは、**英語の構造・スタイル指示（テンプレート）＋ 日本語のシーン内容をそのまま埋め込む**ハイブリッド文字列（Gemini は日本語入力に対応するため純関数のまま翻訳不要）。固有名詞は保持。

### 3. 画像生成層（`src/lib/imageGen.ts` — 新規・薄い分離）
`generateStoryboardImage(prompt: string): Promise<{ bytes: Uint8Array; mime: string; model: string }>`
- **Nano Banana を Vercel AI Gateway 経由**で呼ぶ。
- キー未設定時は `AIConfigError`（既存パターン）に倣った明確な例外。
- ⚠ 実装時に確定する詳細（設計はこの層に隠蔽するので不変）:
  - AI SDK の画像生成API（`experimental_generateImage`）か、Geminiの画像出力を `generateText` で受けるか。
  - 正確な gateway モデルID（`google/…`）。

### 4. APIルート（`src/app/api/generate-storyboard/route.ts` — 新規）
- `runtime = "nodejs"`。
- 入力バリデーション（project/section不足→400、脚本モード以外→400）。
- `buildStoryboardPrompt` → `generateStoryboardImage` → Blob `put(path, bytes, { access: "public", contentType })` → `{ url, prompt, model, generatedAt }` を200で返却。
- 失敗時: `AIConfigError`→設定エラー文言、その他→`生成に失敗しました：<msg>`（サイレント失敗にしない）。

### 5. UI（`src/app/writer/page.tsx` ほか、脚本モードのみ）
- 各シーンに **「絵コンテ生成」ボタン**、生成中スピナ、**サムネ表示**、**再生成**。
- 返却URLをクライアントで `Section.storyboard` に保存（既存の保存ヘルパに倣う。`storage.ts` に `saveSectionStoryboard(projectId, chapterId, sectionId, storyboard)` を追加）。
- 脚本モード以外では出さない。

### 6. 保存（`src/lib/storage.ts`）
- `saveSectionStoryboard(...)`：対象 Section に `storyboard` を設定して永続化。
- `mergeDefaults`：`storyboard` は任意なので明示バックフィル不要（undefinedのまま）。既存プロジェクト互換。

## データフロー / 状態
- 画像バイト列は**サーバ内で完結**（受信→Blob put）。クライアントには**URLのみ**渡る。
- localStorage に載るのは `Storyboard`（URL文字列＋短いメタ）だけ＝肥大化しない。

## エラー処理
- キー未設定（AI Gateway / Blob トークン）: 設定エラーを明確に返す。
- 画像生成失敗 / Blob 失敗: それぞれ判別可能なメッセージ。UIはインライン表示。
- 空/不完全なシーン: プロンプトは `?.` ガードで生成継続（最低限 location/purpose が無くても落ちない）。

## テスト
- **純関数ユニット**（`buildStoryboardPrompt`）: 各 `sceneMeta` フィールドがプロンプトに反映される／`presentCharacters` に対応するキャラ設定が注入される／フィールド欠落時も throw しない／スタイル接尾辞が付く。
  - テスト基盤は未整備のため、既存方針（一回限りの node 実行 or 純関数の最小テスト）に合わせる。
- **手動＋実ブラウザ確認**: APIルート・Blob保存・実モデル生成・再生成・リロード後表示（過去メモの教訓：この種の生成は実ブラウザで検証）。
- `tsc --noEmit` と `next build` をパスさせる。

## 環境変数（Vercel）
- `AI_GATEWAY_API_KEY`（or Google 直キー）
- `BLOB_READ_WRITE_TOKEN`（Vercel Blob 有効化）

## スコープ外（v1でやらない・YAGNI）
- 参照画像による一貫性（③）
- 1シーン複数カット / カット割り
- 全シーン一括生成
- 動画生成（別プロダクト）
- スタイルの複数種切替
- 香盤表CSV等への画像埋め込み
- 画像の履歴管理（`bodyHistory` 相当）

いずれも後追いできる形（`Storyboard` 単数→配列化、スタイル定数→選択、など）で残す。

## 想定ファイル変更
- 追加: `src/lib/storyboardPrompt.ts`, `src/lib/imageGen.ts`, `src/app/api/generate-storyboard/route.ts`
- 変更: `src/lib/types.ts`（`Storyboard`, `Section.storyboard`）, `src/lib/storage.ts`（保存ヘルパ）, `src/app/writer/page.tsx`（UI）, `package.json`（`@vercel/blob`、必要なら AI SDK 画像関連）

## 未確定（実装時に解決する小項目）
- Gemini 画像の正確な呼び出し方式（AI SDK 画像API vs generateText 画像出力）と gateway モデルID。
- 生成解像度／Blob に置く際の圧縮・フォーマット（表示はサムネで足りるので軽量化を検討）。
- スタイル接尾辞の最終文言。
