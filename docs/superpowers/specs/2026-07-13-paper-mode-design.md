# 論文モード 設計書

日付: 2026-07-13 / 対象: アキカゼ出版AI（8番目のジャンル追加: genre "paper"）

ユーザー要望:
1. HANDOFF ロードマップの **論文モード**（IMRaD構成 + 簡易査読）を実装する
2. 文系論文に加えて **AI・情報系の論文** も書けるようにする
3. 翻訳は既存の翻訳書モード（原文種別=論文・学術 + グローバル対訳表）に任せ、
   論文モードは **執筆に専念** する（別プロジェクトとして翻訳書モードを使う運用）

## 方針

既存の GenreConfig 駆動アーキテクチャに完全に乗る（新ジャンル追加 = config + プロンプト +
専任エージェント。画面骨格 01素材→02構成→03執筆→04レビュー は固定）。
実装パターンはニュース記事モード（2026-07-06）の前例に従う。

### 位置づけと非目標（重要）

論文モードは **学術論文の執筆支援** であり、**査読通過の保証や厳密な学術的妥当性の保証は
しない**。簡易査読・校閲・出典チェックはいずれも「著者が自分で気づくための補助診断」であって、
真偽・実在・妥当性を保証するものではない。この位置づけは /（素材画面）の help 文言と
簡易査読エージェントの description にも一行で明示する。

---

## 1. ジャンル定義（genreConfig）

- `genre: "paper"`、ラベル「論文」
- ステージ: 素材=「研究素材」／構成=「論文構成」／執筆=「執筆」／レビュー=「査読レビュー」
- ナレッジ: `/references`（参考文献・用語集。ビジネス書と同じ画面を流用）+ 執筆メモリ + 参照ライブラリ
- 素材パネル: 研究メモ・データ・実験結果・先行研究の要点を貼り付ける。help に非目標
  （査読通過保証はしない）を一行入れる。subjectLabel は「著者名／所属」

## 2. PaperMeta（素材画面に入力パネル。newsMeta と同パターン）

```ts
export type PaperType = "empirical" | "ai-cs" | "review" | "humanities";

export type PaperMeta = {
  paperType: PaperType;      // 構成テンプレート分岐（下記の注記参照）
  field: string;             // 分野（例: 教育学、自然言語処理）
  researchQuestion: string;  // リサーチクエスチョン・仮説
  contributions: string;     // 主張したい貢献・新規性
  venue: string;             // 想定投稿先・読者（紀要／学会誌／一般向け学術書 等）
  keywords?: string;         // キーワード（カンマ区切り。任意）
};
```

- **paperType は厳密な分類体系ではなく、構成テンプレート分岐のための実用分類である**。
  「原著（実証・IMRaD）＝形式軸」「AI・情報系＝分野軸」のように分類軸が混在していることは
  承知の上での MVP 分類（4択で1コントロールに収める）。
  将来、実証／提案／調査／理論／実装報告などの方法論軸が必要になったら、paperType を
  作り直すのではなく **optional な `methodology?: string` フィールドを PaperMeta に追加**して
  直交させる（今回は実装しない。拡張余地の予約のみ）
- `paperType: "ai-cs"` のとき、構成プロンプトへの extraContext が CS 系の流儀
  「序論→関連研究→提案手法→実験・評価→考察→結論」を指示する
  （脚本のメディア種別と同じ、`buildScreenplayExtraContext` ディスパッチャ経由の分岐）
- PAPER_TYPE_OPTIONS / paperTypeLabel を genreConfig に置く（NEWS_TYPE_OPTIONS と同パターン）

## 3. 構成案3案の型

内部キーは既存の OutlineType（chronological / thematic / narrative）を維持し、
表示ラベルだけ差し替える（outlineTypeLabels）:

- chronological → **IMRaD・実証型**（序論→方法→結果→考察。paperType=ai-cs のときは
  関連研究・実験・評価を含む CS 変形をプロンプトが指示）
- thematic → **総説・レビュー型**（先行研究の整理・統合）
- narrative → **人文社会・章立て型**（問題設定→各論→結論。「物語調」と誤読されないよう
  UI 表示は必ず「章立て」を含むこのラベルを使う。内部キー narrative は既存整合のため維持）

paperType と矛盾する案も参考として出るが、最終的に1案選択なので実害なし（他ジャンルと同じ挙動）。
ただし `prompt-outline-paper` には **「paperType と最も整合する型の案を第1案にし、他の2案は
代替構成として提示する」** と指示する（3案制を維持しつつ納得感を上げる）。

**章の役割（プロンプトレベルで導入。型変更なし）**: 構成案の各章 `summary` の冒頭に
`【役割: 序論】【役割: 関連研究】【役割: 方法】【役割: 結果】【役割: 考察】【役割: 結論】` 等の
役割タグを付けるよう `prompt-outline-paper` に指示する。`chapterSummary` は既に
sections / draft プロンプトへ渡っているため、`prompt-sections-paper` と `prompt-draft-paper` は
このタグを読んで「章の役割に応じた節立て・書き方」を切り替えられる。
構造化フィールド（PaperSectionRole 型）の追加は既存の outline JSON パースへの波及が大きいので
今回はやらない（プロンプト運用で不足が出たら型化を検討）。

## 4. AIスタッフ

### 新規プロンプト4本（samples.ts の defaultPrompts に追加）

- `prompt-outline-paper` — IMRaD／総説／章立ての3案生成。PaperMeta（分野・RQ・貢献・投稿先・
  キーワード）を参照。第1案は paperType と整合する型、各章 summary に役割タグ（§3参照）
- `prompt-sections-paper` — 各章に節を展開。章の役割タグを読んで節立てを変える
  （方法なら「対象→手続き→分析」、関連研究なら「系譜→比較→本研究の位置づけ」等）
- `prompt-draft-paper` — 学術文体（である調）、主張と根拠の対応、断定と限界の書き分け、
  先行研究への位置づけ、章の役割タグに応じた書き方。AIスロップ禁止規則は他ジャンル同様。
  **引用は「引用・出典の安全ルール」（後述）に従う**。
  **venue に応じた書き分け**も明示する:
  - 一般向け（学術書・一般書）→ 専門用語を初出時に説明する
  - 学会誌 → 先行研究との差分と方法の透明性を重視する
  - 紀要 → 研究目的・教育的意義・実践的含意を丁寧に書く
- `prompt-agent-peer-review` — **簡易査読**（新規 AgentKey `"peer-review"`）。共通観点:
  1. **問題設定の明確さ**（何を明らかにするのかが冒頭で立っているか）
  2. 新規性・貢献の明確さ
  3. 方法の妥当性
  4. 再現性・検証可能性
  5. 主張と証拠の対応
  6. 限界の認識（limitations の明示）
  7. 倫理・バイアス・適用範囲
  8. 構成の明瞭性
  description に「査読通過を保証するものではない」旨を明示

### paperType 別の追加査読観点

peer-review の system prompt に serializePaperMeta を渡し、paperType に応じて観点を追加する:

**paperType = "ai-cs" のとき追加**:
- 提案手法が既存研究との差分として明確か
- 評価指標の妥当性・比較対象（ベースライン）の有無
- データセット・実験条件・実装条件の再現性
- 性能向上の主張が実験結果と対応しているか
- 限界・失敗例・適用範囲の記述

**paperType = "empirical" のとき追加**:
- 対象者・データ取得方法が明確か
- 倫理的配慮（個人情報・センシティブデータへの配慮を含む）
- 分析方法がリサーチクエスチョンと対応しているか
- サンプルサイズ・対象範囲の限界が明示されているか

### 簡易査読の出力形式

他エージェントと同じ **共通 AgentFinding パイプライン**（findings[] → /review 集約）に乗せる。
専用のレポート型・専用UIは作らない。その上で形式を固定する:

- findings の並び順: 【総評】→ 重大 → 中程度 → 軽微 → 提案 → 【良い点】→ 【投稿前チェック】
- 4段階の深刻度は message の**プレフィックスで保持**し、既存の3段階 AgentSeverity に写像する:
  - 【重大】critical → `error`
  - 【中】major → `warning`
  - 【軽微】minor → `info`
  - 【提案】suggestion → `info`
- 【総評】（修正優先順位を1〜2文で含む）・【良い点】・【投稿前チェック】は `info` で出力
- 新しい ReviewSeverity 型は導入しない（AgentFinding を消費する /review・/writer の
  集約表示を壊さないため。プレフィックスで4段階の情報量は失わない）

### 既存流用（genres に "paper" を追加 + draft.ts の分岐拡張）

- `logic-check`（論理構成チェック）・`citation-check`（出典チェック）: ビジネス書用を論文にも適用
- `fact-check`（校閲・事実確認）: 実話・実用系の適用対象に論文を追加
- 共通4本（校正・文体守護・整合性・読者体験）はそのまま

**論文モードにおける守備範囲の明文化**（プロンプトの system 指示と staffRegistry の
description の両方に反映する）:

- `fact-check` は **外部知識との真偽の断定ではなく**、本文内の主張・数字・因果関係の
  不自然さ・矛盾の検出を主目的とする（素材との照合が主、一般知識は従）。
  **論文モードでの表示名は「校閲・本文内整合」に差し替える**（「事実確認」だと外部真偽確認と
  誤解されるため）。仕組み: StaffMeta に `labelOverrides?: Partial<Record<Genre, string>>` を
  追加し、`agentLabel(agentKey, genre?)` と reviewers.ts のレポート label 生成が genre を見て
  差し替える。内部キー `fact-check` は不変
- `citation-check` は **文献の実在確認ではなく**、出典が必要な箇所の不足・引用の過不足・
  主張と引用の紐づきの粗さを検出する補助である。論文モードではさらに
  **本文中の引用マーカーが references に存在するか**の突き合わせを行う（下記の安全ルール）
- `peer-review` は上記の通り査読通過を保証しない

### 引用・出典の安全ルール（最重要）

論文モードでは、**AIが架空の文献・著者・年を補完しないこと**を最重要ルールとする。
もっともらしい架空文献の生成が論文モード最大の事故なので、生成側と検査側の両方で守る:

- 本文中の引用マーカー〔著者, 年〕は、**references ナレッジに存在する文献に限って**使用する
  （`prompt-draft-paper` の system prompt に明記。buildPaperContext が references 一覧を渡す）
- references に存在しないが出典が必要な箇所は、架空文献を作らず **〔要出典〕** と書く
- 不確かな文献名・著者名・年を推測で補完しない
- `citation-check` は、(1) 本文中の引用マーカーが references に存在するか、
  (2) 主張と引用が対応しているか、(3) 〔要出典〕の残存、を確認する
- 文献の実在確認・外部DB照合は行わない（§8 YAGNI の通り）

→ 本文生成後の自動レビューは計8本（校正・文体守護・整合性・読者体験・校閲・論理・出典・簡易査読。
参照ライブラリ選択時はさらに +2本）

### レビュー実行タイミング

MVP は **既存どおり本文生成後の自動実行** とする。判断根拠:

- レビュアーは draftWorkflow 内で `Promise.all` の**並列実行**であり、体感の待ち時間は
  「本数の合計」ではなく「最も遅い1本」で決まる。ニュースモードは既に自動7本で
  180秒制限内で運用できており、8本は +1 本の差でしかない
- 全7ジャンルが自動実行で統一されており、論文だけ手動にすると /writer の UI 分岐が増える
- 重いと感じる場合の逃げ道は既存の `agentToggles`（/staff で個別 OFF）がそのまま効く

「レビューだけ再実行」ボタン（本文生成と切り離した手動実行）は、既存ロードマップの
P6 通しレビュー（/review の「全体レビューを実行」）と合流させて将来対応とする。

## 5. コンテキスト注入

`buildPaperContext(project)` を draft.ts に追加（buildBusinessContext がベース）。
reviewers.ts では簡易査読・出典・論理チェックの system prompt に同等のコンテキストを渡す。

**全部入れない方針（肥大化ガード）**:

- **PaperMeta は常時注入**（短い固定サイズなので全文）
- 参考文献 `references` と用語集 `glossary` は **ビジネス書と同じ縮約形式**
  （タイトル・著者・年・notes の1行サマリのみ。原文や長文は入れない）
- 参照ライブラリは既存の `buildReferenceContext` の縮約（作品カルテのみ）のままで、
  論文モードで注入量を増やさない
- 章執筆時の既存挙動（他章は先頭240字のサマリのみ = `previousChapterSummaries`）を維持し、
  論文だからといって全文脈を注入しない

## 6. データ・後方互換

- `types.ts`: `Genre` に `"paper"`、`PaperType` / `PaperMeta` 追加、`AgentKey` に `"peer-review"`、
  `Project.paperMeta?: PaperMeta`（optional）
- `storage.ts`: `mergeDefaults` に `paperMeta: (p as any).paperMeta ?? undefined` を追加、
  `updatePaperMeta` ヘルパ追加（updateNewsMeta と同パターン）
- `staffRegistry.ts`: 新規スタッフ4本 + 流用3本の genres 更新。
  `plannedGenres` から「論文」を、`plannedRiskStaff` から「簡易査読」を削除（実装済みになるため）

**後方互換の保証（明文化）**:

- `paperMeta` は optional。**旧プロジェクト（paperMeta 不在）はそのまま読める**
  （mergeDefaults が undefined で補完。newsMeta 等と同じ扱い）
- `genre !== "paper"` のプロジェクトでは paperMeta は無視される（UI も分岐も参照しない）
- 素材画面のパネルは `project.paperMeta?.field ?? ""` のように常に optional アクセスで描画し、
  未入力でも構成生成が動く（extraContext が「（未設定）」を出すだけ）

**表示の残骸チェック**: `plannedGenres` / `plannedRiskStaff` 削除に加え、
「論文」「今後対応」「予定」等で `src/` を grep し、/settings のロードマップ表示・
empty state・HANDOFF.md に「論文＝予定」の古い文言が残っていないことを確認する
（staffRegistry の omission/terminology の description「論文モードでも流用予定」も
今回の守備範囲＝翻訳書モード側の文言なので「翻訳書モード」に修正）。

## 7. 触るファイル

- `src/lib/types.ts` — Genre / PaperType / PaperMeta / AgentKey / Project.paperMeta
- `src/lib/genreConfig.ts` — paperConfig / PAPER_TYPE_OPTIONS / extraContext 分岐
- `src/lib/staffRegistry.ts` — スタッフ登録・genres 更新・planned 削除・
  `labelOverrides` / `agentLabel(agentKey, genre?)`（fact-check の論文向け表示名）
- `src/lib/samples.ts` — defaultPrompts に4本追加
- `src/lib/storage.ts` — mergeDefaults / updatePaperMeta
- `src/workflows/draft.ts` — buildPaperContext / エージェント分岐（paper で 校閲・論理・出典・簡易査読）
- `src/workflows/agents/reviewers.ts` — peerReviewStep + AgentDef / serializePaperMeta
- `src/app/page.tsx` — paperMeta 入力パネル（newsMeta と同パターン）
- `agentLabel()` の呼び出し箇所（/review・/writer 等）— genre 引数の追加に追随
- `HANDOFF.md` — 7ジャンル表→8ジャンル・ロードマップ更新

## 8. やらないこと（YAGNI）

- 論文モード内の翻訳・英文化（翻訳書モード workType="paper" の守備範囲）
- 専用ナレッジ画面（/research 等）。RQ・仮説は PaperMeta の1フィールドで足りる
- `methodology` フィールドの実装（拡張余地の予約のみ）
- 文献の実在確認・外部DB照合（Semantic Scholar 等との連携は将来検討）
- 参考文献の書式整形（BibTeX / 各誌スタイル対応）
- `PaperSectionRole` の型化（章の役割はプロンプトの役割タグで運用。§3）
- `ReviewSeverity` 4段階型の導入（既存 AgentFinding 3段階 + プレフィックスで表現。§4）
- 査読専用レポートUI（共通の /review 集約に乗せる）
- レビューの手動実行ボタン（P6 通しレビューと合流させて将来対応。§4）

## 9. 検証

1. `npx tsc --noEmit` + `npx next build`（この repo のコミット前必須運用）
2. **paper 通し確認**（dev サーバ + ブラウザ）: 素材（PaperMeta入力）→ 構成3案 → 節展開 →
   本文生成 → 査読レビュー8本が /review に出るまで。paperType=ai-cs で構成が CS 流儀に
   変わること、references 未登録の状態で本文に架空の引用マーカーが出ず〔要出典〕に
   なることも確認
3. **既存ジャンルの回帰確認**（smoke test）: ビジネス書とニュース記事（今回 genres と
   draft.ts 分岐を触るジャンル）で 構成→本文→レビュー が従来通り動くこと
4. **旧プロジェクトの読込確認**: paperMeta を持たない既存プロジェクト（JSON インポートで可）が
   エラーなく開けること
