# 論文モード Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** アキカゼ出版AIに8番目のジャンル「論文」（genre: "paper"）を追加する — IMRaD構成 + 簡易査読 + 引用安全ルール。

**Architecture:** 既存の GenreConfig 駆動パターン（ニュースモードの前例に従う）。新ジャンル追加 = types + genreConfig + プロンプト4本 + staffRegistry + reviewers/draft の分岐 + 素材画面のメタパネル。画面骨格（01素材→02構成→03執筆→04レビュー）は固定で触らない。

**Tech Stack:** Next.js 14 App Router / TypeScript / Vercel Workflow SDK（"use workflow" / "use step"）/ localStorage 主体。

**Spec:** `docs/superpowers/specs/2026-07-13-paper-mode-design.md`（承認済み。実装判断に迷ったらこちらが正）

## Global Constraints

- このリポジトリには**ユニットテスト基盤がない**。検証は `npx tsc --noEmit`（各タスク後）+ `npx next build`（コミット前必須・HANDOFF記載の運用）+ ブラウザ通し確認（最終タスク）
- コミットは `git -c user.name="Will" -c user.email="tachiiri@westernavenu.com" commit` で作成し、末尾に `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- 論文モードは**執筆支援であり、査読通過・学術的妥当性を保証しない**（UI文言・プロンプトに明示済みの文言を変えない）
- **架空文献の生成禁止**が最重要ルール: 引用マーカー〔著者, 年〕は references 登録文献のみ、無ければ〔要出典〕
- 新しい severity 型・専用レポートUIは**作らない**（既存 AgentFinding: info/warning/error + message プレフィックスで表現）
- `Date.now()` 等の使用制約はなし（通常の Next.js コード）
- 既存コードのコメント密度・命名・日本語コメントのスタイルに合わせる

---

### Task 1: 型・genreConfig・storage（"paper" が型レベルで通る最小単位）

`Genre` に "paper" を足すと `genreConfig.ts` の `Record<Genre, GenreConfig>` が即座に型エラーになるため、types / genreConfig / storage は**1タスクで原子的に**変更する。

**Files:**
- Modify: `src/lib/types.ts`（Genre / PaperType / PaperMeta / AgentKey / Project.paperMeta）
- Modify: `src/lib/genreConfig.ts`（paperConfig / PAPER_TYPE_OPTIONS / paperTypeLabel / extraContext 分岐）
- Modify: `src/lib/storage.ts`（mergeDefaults / updatePaperMeta）

**Interfaces:**
- Produces: `type PaperType = "empirical" | "ai-cs" | "review" | "humanities"`、`type PaperMeta = { paperType: PaperType; field: string; researchQuestion: string; contributions: string; venue: string; keywords?: string }`、`Project.paperMeta?: PaperMeta`、AgentKey に `"peer-review"`、`paperConfig: GenreConfig`、`PAPER_TYPE_OPTIONS`、`paperTypeLabel(v: string | undefined): string`、`updatePaperMeta(meta: PaperMeta): Project`。後続タスクはこれらの名前をそのまま使う。

- [ ] **Step 1: types.ts に PaperType / PaperMeta / Genre / AgentKey / Project.paperMeta を追加**

`src/lib/types.ts` の `Genre` union（`| "translation";` の行、208行付近）を変更:

```ts
export type Genre =
  | "biography"
  | "novel"
  | "business"
  | "screenplay"
  | "blog"
  | "news"
  | "translation"
  | "paper";
```

`AgentKey` の `// 翻訳書専用（論文モードでも流用予定）` ブロックの**前**に追加（コメントも修正する。既存の `// 翻訳書専用（論文モードでも流用予定）` は `// 翻訳書専用` に変更）:

```ts
  // 論文専用
  | "peer-review"
```

`NewsMeta` 型の直後（`// ===== 翻訳書モード =====` の前）に追加:

```ts
// ===== 論文モード =====

/**
 * 論文の種類。厳密な分類体系ではなく、構成テンプレート分岐のための実用分類
 * （形式軸と分野軸が混在していることは承知の上の MVP 4択）。
 * 将来、方法論軸（実証/提案/調査/理論/実装報告）が必要になったら paperType を
 * 作り直さず、optional な methodology フィールドを PaperMeta に追加して直交させる。
 */
export type PaperType = "empirical" | "ai-cs" | "review" | "humanities";

export type PaperMeta = {
  paperType: PaperType;      // 構成テンプレート分岐（ai-cs は序論→関連研究→提案手法→実験の流儀）
  field: string;             // 分野（例: 教育学、自然言語処理）
  researchQuestion: string;  // リサーチクエスチョン・仮説
  contributions: string;     // 主張したい貢献・新規性
  venue: string;             // 想定投稿先・読者（紀要／学会誌／一般向け学術書 等）
  keywords?: string;         // キーワード（カンマ区切り。任意）
};
```

`Project` 型の `newsMeta?: NewsMeta;` の直後に追加:

```ts
  // ===== 論文 =====
  paperMeta?: PaperMeta;
```

- [ ] **Step 2: genreConfig.ts に paperConfig を追加**

`translationConfig` の直後・`const registry` の前に追加:

```ts
export const paperConfig: GenreConfig = {
  genre: "paper",
  label: "論文",
  stages: {
    material: {
      navLabel: "素材",
      pageTitle: "研究素材",
      description: "研究メモ・データ・実験結果・先行研究の要点を整理し、論文構成案を生成します。",
    },
    structure: {
      navLabel: "構成",
      pageTitle: "論文構成",
      description: "IMRaD・実証／総説・レビュー／人文社会・章立ての3案から方向性を選びます。",
    },
    writing: {
      navLabel: "執筆",
      pageTitle: "執筆",
      description: "節単位で、主張と根拠の対応・引用の規律を守った本文を生成します。",
    },
    review: {
      navLabel: "レビュー",
      pageTitle: "査読レビュー",
      description: "簡易査読・論理・出典・校閲の診断を集約して確認します。",
    },
  },
  knowledge: [
    { href: "/references", label: "参考文献・用語集" },
    { href: "/memory", label: "執筆メモリ" },
    { href: "/library", label: "参照ライブラリ" },
  ],
  material: {
    panelTitle: "研究素材",
    placeholder:
      "研究の背景、リサーチクエスチョン、方法のメモ、データ・実験結果、先行研究の要点などを自由に入力してください。",
    help: "研究素材と論文仕様（種別・分野・RQ・貢献）をもとに、論文構成と本文を生成します。参考文献をナレッジに登録すると、引用と出典チェックに使われます。※本モードは執筆支援であり、査読通過や学術的妥当性を保証するものではありません。",
    subjectLabel: "著者名／所属",
  },
  pipelinePrompts: {
    outline: "prompt-outline-paper",
    sections: "prompt-sections-paper",
    draft: "prompt-draft-paper",
  },
  outlineTypeLabels: {
    chronological: "IMRaD・実証型",
    thematic: "総説・レビュー型",
    narrative: "人文社会・章立て型",
  },
};
```

`registry` に追加:

```ts
const registry: Record<Genre, GenreConfig> = {
  biography: biographyConfig,
  novel: novelConfig,
  business: businessConfig,
  screenplay: screenplayConfig,
  blog: blogConfig,
  news: newsConfig,
  translation: translationConfig,
  paper: paperConfig,
};
```

- [ ] **Step 3: genreConfig.ts に PAPER_TYPE_OPTIONS と extraContext 分岐を追加**

`// ===== 翻訳書: 言語・原文種別のプリセット =====` セクションの直前に追加:

```ts
// ===== 論文: 論文種別のプリセット =====

/** 論文種別。厳密な分類ではなく構成テンプレート分岐のための実用分類（設計書 §2） */
export const PAPER_TYPE_OPTIONS: {
  value: import("./types").PaperType;
  label: string;
}[] = [
  { value: "empirical", label: "原著（実証・IMRaD）" },
  { value: "ai-cs", label: "AI・情報系" },
  { value: "review", label: "総説・レビュー" },
  { value: "humanities", label: "人文社会" },
];

export function paperTypeLabel(v: string | undefined): string {
  return PAPER_TYPE_OPTIONS.find((o) => o.value === v)?.label ?? "原著（実証・IMRaD）";
}
```

`buildScreenplayExtraContext` のパラメータ型に追加（`newsMeta?: {...};` の直後）:

```ts
  paperMeta?: import("./types").PaperMeta;
```

同関数の `if (p.genre === "news" && p.newsMeta) {...}` ブロックの直後・`return "";` の前に追加:

```ts
  if (p.genre === "paper" && p.paperMeta) {
    const m = p.paperMeta;
    const structureNote =
      m.paperType === "ai-cs"
        ? "構成の流儀: AI・情報系（序論→関連研究→提案手法→実験・評価→考察→結論）を基本とする"
        : m.paperType === "review"
          ? "構成の流儀: 総説・レビュー（先行研究の整理・統合）を基本とする"
          : m.paperType === "humanities"
            ? "構成の流儀: 人文社会・章立て（問題設定→各論→結論）を基本とする"
            : "構成の流儀: IMRaD（序論→方法→結果→考察）を基本とする";
    return (
      "【論文仕様】\n" +
      `論文種別: ${paperTypeLabel(m.paperType)}\n` +
      `分野: ${m.field || "（未設定）"}\n` +
      `リサーチクエスチョン・仮説: ${m.researchQuestion || "（未設定）"}\n` +
      `主張したい貢献・新規性: ${m.contributions || "（未設定）"}\n` +
      `想定投稿先・読者: ${m.venue || "（未設定）"}\n` +
      (m.keywords ? `キーワード: ${m.keywords}\n` : "") +
      structureNote
    );
  }
```

- [ ] **Step 4: storage.ts に後方互換の補完と updatePaperMeta を追加**

`mergeDefaults` の `newsMeta: (p as any).newsMeta ?? undefined,` の直後に追加（旧プロジェクトに paperMeta が無くても undefined で安全に読める）:

```ts
    paperMeta: (p as any).paperMeta ?? undefined,
```

`updateNewsMeta` の直後（`// ===== 翻訳書 =====` の前）に追加:

```ts
// ===== 論文 =====

export function updatePaperMeta(meta: import("./types").PaperMeta): Project {
  return updateProject((p) => ({ ...p, paperMeta: meta }));
}
```

- [ ] **Step 5: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラー0件。（もし `Record<Genre, ...>` や genre の switch 網羅性で他ファイルがエラーになったら、このタスクの範囲でそのファイルにも "paper" 分岐を足して型を通す — ただし現状の調査では registry のみが網羅必須）

- [ ] **Step 6: Commit**

```bash
git add src/lib/types.ts src/lib/genreConfig.ts src/lib/storage.ts
git -c user.name="Will" -c user.email="tachiiri@westernavenu.com" commit -m "feat: 論文モードの型・GenreConfig・storage（genre \"paper\" / PaperMeta / peer-review）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: プロンプト4本 + fact-check/citation の論文向け注意（samples.ts）

**Files:**
- Modify: `src/lib/samples.ts`（defaultPrompts 配列に4本追加 + 既存2本の userPromptTemplate 修正）

**Interfaces:**
- Consumes: なし（純データ追加。プロンプト id は文字列参照なので他タスクと独立にコンパイル可能）
- Produces: プロンプト id `prompt-outline-paper` / `prompt-sections-paper` / `prompt-draft-paper` / `prompt-agent-peer-review`。`prompt-agent-fact-check` と `prompt-agent-citation` の userPromptTemplate に `{{genreNote}}` 変数（Task 4 の buildVars が値を渡す。未指定なら renderTemplate が空文字にするので既存ジャンルは無影響）

- [ ] **Step 1: 論文パイプラインプロンプト3本を追加**

`src/lib/samples.ts` の `// ===== ニュース記事モード: パイプラインプロンプト =====` セクションの後（`prompt-agent-neutrality` エントリの後）に、以下の4エントリを追加する:

```ts
  // ===== 論文モード: パイプラインプロンプト =====
  {
    id: "prompt-outline-paper",
    name: "構成案プランナー（論文）",
    description: "論文モード用。研究素材から論文構成案を3方向で提案する。各章に役割タグを付ける。",
    systemPrompt: `あなたは学術出版の経験が長い編集者で、論文指導の経験も豊富です。
研究素材をもとに、論文の構成案を3種類作成してください。

必ず以下の3方向で提案してください。

1. IMRaD・実証型 (type: "chronological")
   序論→方法→結果→考察（→結論）。実証研究の標準形。
   ただし【論文仕様】の論文種別が「AI・情報系」の場合は、
   序論→関連研究→提案手法→実験・評価→考察→結論 の流儀にする
2. 総説・レビュー型 (type: "thematic")
   先行研究の整理・統合。テーマ設定→レビューの方法→系譜・論点ごとの整理→統合と展望
3. 人文社会・章立て型 (type: "narrative")
   問題設定→各論（論点ごとの章）→結論。理論・思想・歴史研究の標準形

重要:
- 【論文仕様】の論文種別と最も整合する型の案を proposals の先頭（第1案）にし、
  他の2案は代替構成として提示する
- 各章の summary の冒頭に、その章の役割を
  【役割: 序論】【役割: 関連研究】【役割: 方法】【役割: 結果】【役割: 考察】【役割: 結論】
  【役割: レビュー統合】【役割: 各論】のいずれかの形式で必ず付ける
- 素材にない結果・データを構成に入れない。不確定な要素は「（要確認）」を付けて明示する
- リサーチクエスチョンに答える構成にする（RQ→方法→証拠→答え、の筋が通ること）

各案には以下を含めてください。
- 構成案タイトル（論文タイトル案を兼ねる）
- コンセプト / おすすめ用途 / 章タイトル / 各章の概要（冒頭に役割タグ）`,
    userPromptTemplate: `著者名／所属：{{intervieweeName}}
研究テーマ：{{theme}}
想定読者：{{targetReader}}
文体の希望：{{desiredTone}}

{{extraContext}}

【研究素材】
{{interviewNotes}}

上記から、論文の構成案を3案、JSONで返してください。`,
    outputFormat: `{
  "proposals": [
    {
      "id": "outline-a",
      "title": "（論文タイトル案）",
      "type": "chronological",
      "concept": "...",
      "recommendedFor": "...",
      "chapters": [
        { "id": "chapter-1", "chapterNumber": 1, "title": "序論", "summary": "【役割: 序論】...", "sections": [] }
      ]
    }
  ]
}`,
  },
  {
    id: "prompt-sections-paper",
    name: "節構成担当（論文）",
    description: "論文モード用。各章の役割タグに応じた節を展開する。",
    systemPrompt: `あなたは学術出版の編集者です。
渡される構成案の各章に対し、2〜4個の節（section）を必ず生成してください。

節の設計方針:
- 章の summary 冒頭の役割タグ（【役割: 方法】等）を読み、役割に応じた節立てにする
  - 序論: 背景 → 問題の所在 → リサーチクエスチョン → 本稿の構成
  - 関連研究: 系譜・分類 → 比較 → 本研究の位置づけ
  - 方法: 対象・データ → 手続き → 分析方法
  - 結果: 主要な結果 → 補足的な結果（解釈は含めない）
  - 考察: 結果の解釈 → 先行研究との比較 → 限界 → 含意
  - 結論: 要約 → 貢献 → 今後の課題
  - レビュー統合／各論: 論点ごとに1節
- 各節の概要には「この節で述べること」と「依拠する素材・根拠」を書く
- 素材にない結果を約束する節を作らない

【重要・出力形状】
渡された構成案の chapters 配列を、そのままの順序・id・title・summary で保持しつつ、
各 chapter の sections 配列に節を追加して返してください。
chapter を間引いたり、id・title・summary（役割タグを含む）を改変してはいけません。`,
    userPromptTemplate: `【研究素材】
{{interviewNotes}}

【選択済み構成案】
{{selectedOutline}}

【執筆メモリ】
{{writingMemory}}

{{extraContext}}

上記の構成案の全章に、節（sections）を展開して返してください。`,
    outputFormat: `{
  "outline": {
    "id": "（そのまま）",
    "title": "（そのまま）",
    "type": "（そのまま）",
    "concept": "（そのまま）",
    "recommendedFor": "（そのまま）",
    "chapters": [
      {
        "id": "chapter-1",
        "chapterNumber": 1,
        "title": "（渡されたtitle）",
        "summary": "（渡されたsummary）",
        "sections": [
          { "id": "section-1-1", "title": "節タイトル", "summary": "この節で述べることと、依拠する素材・根拠" }
        ]
      }
    ]
  }
}`,
  },
  {
    id: "prompt-draft-paper",
    name: "本文ライター（論文）",
    description:
      "論文モード用。学術文体・主張と根拠の対応・引用の安全ルール（架空文献の禁止）・venue別の書き分けで本文を書く。",
    systemPrompt: `あなたは学術論文の執筆支援を行う編集者兼ライターです。
指定された節の本文を、以下の学術的規律で執筆してください。

【文体】
- である調（常体）。ただし文体の希望が指定されていればそれに従う
- 一文を短く、係り受けを明確に。主観的な強調語（「非常に」「画期的な」等）を避ける
- 章の役割タグ（【役割: 方法】等）に応じた書き方をする
  （方法=再現可能な記述 / 結果=解釈抜きの記述 / 考察=結果に基づく解釈）

【主張と根拠（最重要）】
- すべての主張に根拠（データ・先行研究・論理）を対応させる。根拠のない断定をしない
- 素材にない結果・数値を捏造しない。数値・固有名詞は素材の表記を正確に転記する
- 断定できることと、示唆にとどまることを書き分ける
  （「〜が示された」vs「〜の可能性が示唆される」）
- 研究の限界に触れるべき箇所では正直に書く

【引用・出典の安全ルール（最重要）】
- 引用マーカー〔著者, 年〕は、system prompt で渡される参考文献リストに存在する文献に限って使う
- 参考文献リストにないが出典が必要な箇所は、架空の文献・著者・年を絶対に作らず〔要出典〕と書く
- 不確かな文献名・著者名・年を推測で補完しない

【想定投稿先に応じた書き分け】
- 一般向け（学術書・一般書）の場合: 専門用語を初出時に説明する
- 学会誌の場合: 先行研究との差分と方法の透明性を重視する
- 紀要の場合: 研究目的・教育的意義・実践的含意を丁寧に書く

出力には以下を含めてください。
1. 本文
2. 編集メモ（editorNotes: 編集者視点の注意点）
3. 追加質問（followUpQuestions: 著者に確認すべきこと）
4. 事実確認ポイント（factCheckPoints: 裏取りが必要な数値・主張・〔要出典〕箇所）
5. 前後のつながりメモ（continuityNotes）`,
    userPromptTemplate: `【論文情報】
著者名／所属：{{intervieweeName}}
研究テーマ：{{theme}}
想定読者：{{targetReader}}
文体の希望：{{desiredTone}}

【研究素材】
{{interviewNotes}}

【執筆メモリ】
{{writingMemory}}

【選択済み構成案サマリ】
{{outlineSummary}}

【これまでに書いた節の要約】
{{previousChapterSummaries}}

【今回の章】
{{chapterTitle}}（第{{chapterNumber}}章）
概要：{{chapterSummary}}

【今回の節】
{{sectionTitle}}
概要：{{sectionSummary}}

この節の本文を生成し、JSONで返してください。`,
    outputFormat: `{
  "draft": {
    "body": "本文...",
    "editorNotes": ["..."],
    "followUpQuestions": ["..."],
    "factCheckPoints": ["..."],
    "continuityNotes": ["..."]
  }
}`,
  },
  {
    id: "prompt-agent-peer-review",
    name: "エージェント：簡易査読",
    description:
      "論文モード専用。問題設定・新規性・方法・再現性・主張と証拠・限界・倫理・構成を診断する。査読通過を保証するものではない。",
    systemPrompt: `あなたは学術誌の査読経験が豊富な研究者です。渡された本文（論文の1節）を簡易査読してください。
これは正式な査読ではなく、著者が投稿前に自分で気づくための補助診断です。査読通過を保証するものではありません。

共通の査読観点:
1. 問題設定の明確さ — 何を明らかにするのかが立っているか
2. 新規性・貢献の明確さ
3. 方法の妥当性
4. 再現性・検証可能性
5. 主張と証拠の対応
6. 限界の認識（limitations の明示）
7. 倫理・バイアス・適用範囲
8. 構成の明瞭性

【論文仕様】の論文種別に応じた追加観点:
- AI・情報系の場合:
  提案手法と既存研究との差分の明確さ / 評価指標の妥当性・比較対象（ベースライン）の有無 /
  データセット・実験条件・実装条件の再現性 / 性能向上の主張と実験結果の対応 /
  限界・失敗例・適用範囲の記述
- 原著（実証・IMRaD）の場合:
  対象者・データ取得方法の明確さ / 倫理的配慮（個人情報・センシティブデータへの配慮を含む）/
  分析方法とリサーチクエスチョンの対応 / サンプルサイズ・対象範囲の限界の明示

出力形式（findings の順序と深刻度）:
- 先頭に【総評】を severity="info" で1件（修正の優先順位を1〜2文で含める）
- 続けて指摘を深刻度順に並べ、message の冒頭にプレフィックスを付ける:
  【重大】致命的な問題 → severity="error"
  【中】要修正 → severity="warning"
  【軽微】細部の修正 → severity="info"
  【提案】任意の改善 → severity="info"
- 最後に【良い点】（1〜2件、severity="info"）と
  【投稿前チェック】（確認事項の箇条書き、severity="info"）を入れる
- 各指摘に loc（該当箇所の引用 10〜30字）を含める
- 本文（1節）だけでは判断できない観点（論文全体の構成等）は、その旨を書いた上で節の範囲で評価する`,
    userPromptTemplate: `【本文】
{{body}}

【本節の位置】
第{{chapterNumber}}章「{{chapterTitle}}」／{{sectionTitle}}

【論文仕様】
{{paperContext}}

【参考文献リスト（登録済み）】
{{references}}

簡易査読の結果を JSON で返してください。`,
    outputFormat: `{
  "findings": [
    { "severity": "info", "message": "【総評】方法の記述は再現可能だが、RQと考察の対応が弱い。まず考察の冒頭を修正するのが優先", "loc": "" },
    { "severity": "error", "message": "【重大】「有意な差が確認された」とあるが検定方法・有意水準の記載がなく、主張を証拠が支えていない", "loc": "有意な差が確認された" },
    { "severity": "info", "message": "【投稿前チェック】・引用マーカーが参考文献と一致するか ・限界の節があるか ・図表番号の連番", "loc": "" }
  ]
}`,
  },
```

- [ ] **Step 2: fact-check / citation の userPromptTemplate に {{genreNote}} を追加**

`prompt-agent-fact-check`（samples.ts 1500行付近）の userPromptTemplate を変更。末尾の `校閲結果を JSON で返してください。` の**前**に `{{genreNote}}` 行を挿入:

```ts
    userPromptTemplate: `【本文】
{{body}}

【素材（取材メモ）抜粋】
{{interviewNotes}}

【執筆メモリ（確定済み事実・未確認情報を含む）】
{{writingMemory}}

{{genreNote}}

校閲結果を JSON で返してください。`,
```

`prompt-agent-citation`（720行付近）の userPromptTemplate も同様に、末尾の `出典チェック結果を JSON で返してください。` の**前**に `{{genreNote}}` 行を挿入:

```ts
    userPromptTemplate: `【本文】
{{body}}

【参考文献リスト（登録済み）】
{{references}}

【用語集】
{{glossary}}

{{genreNote}}

出典チェック結果を JSON で返してください。`,
```

※ `renderTemplate`（`src/lib/promptVars.ts`）は未指定の変数を空文字に置換するため、既存ジャンル（buildVars が genreNote を渡さない状態）でも壊れない。ただし Task 4 で両エージェントの buildVars に genreNote を明示的に追加する。

- [ ] **Step 3: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラー0件（純粋なデータ追加なので通るはず）

- [ ] **Step 4: Commit**

```bash
git add src/lib/samples.ts
git -c user.name="Will" -c user.email="tachiiri@westernavenu.com" commit -m "feat: 論文モードのプロンプト4本（構成・節・執筆・簡易査読）と引用安全ルール

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: staffRegistry（新規4本・流用3本・labelOverrides・planned削除）

**Files:**
- Modify: `src/lib/staffRegistry.ts`

**Interfaces:**
- Consumes: Task 1 の `Genre`（"paper" を含む）、Task 2 のプロンプト id（文字列）
- Produces: `StaffMeta.labelOverrides?: Partial<Record<Genre, string>>`、`agentLabel(agentKey: string, genre?: Genre): string`（第2引数は optional なので既存呼び出しはそのまま動く）

- [ ] **Step 1: StaffMeta に labelOverrides を追加**

`StaffMeta` 型の `agentKey?: AgentKey;` の直前に追加:

```ts
  /** ジャンル別の表示名の上書き（例: fact-check は論文では「校閲・本文内整合」）。内部キーは不変 */
  labelOverrides?: Partial<Record<Genre, string>>;
```

- [ ] **Step 2: 企画・執筆スタッフ3本を登録**

`prompt-sections-news` のエントリの直後に追加:

```ts
  {
    promptId: "prompt-outline-paper",
    staffLabel: "構成案プランナー（論文）",
    group: "planning",
    kind: "staff",
    description:
      "IMRaD・実証／総説・レビュー／人文社会・章立ての3方向で論文構成を提案します。論文種別と整合する案を第1案にし、各章に役割タグを付けます。",
    runsWhen: "「章立て案を生成する」実行時（論文モード）",
    genres: ["paper"],
  },
  {
    promptId: "prompt-sections-paper",
    staffLabel: "節構成担当（論文）",
    group: "planning",
    kind: "staff",
    description: "各章の役割タグ（序論・方法・結果・考察等）に応じた節を展開します。",
    runsWhen: "構成案の選択時・節再生成時（論文モード）",
    genres: ["paper"],
  },
```

`prompt-draft-news` のエントリの直後（執筆スタッフのセクション内）に追加:

```ts
  {
    promptId: "prompt-draft-paper",
    staffLabel: "本文ライター（論文）",
    group: "writing",
    kind: "staff",
    description:
      "学術文体（である調）・主張と根拠の対応・引用の安全ルール（参考文献にない文献は〔要出典〕、架空文献の禁止）で本文を執筆します。",
    runsWhen: "「本文を生成」実行時（論文モード）",
    genres: ["paper"],
  },
```

- [ ] **Step 3: 簡易査読を登録し、流用3本の genres を更新**

`prompt-agent-neutrality` のエントリの直後に追加:

```ts
  {
    promptId: "prompt-agent-peer-review",
    staffLabel: "簡易査読",
    group: "review",
    kind: "staff",
    description:
      "問題設定・新規性・方法の妥当性・再現性・主張と証拠の対応・限界・倫理・構成を診断します。論文種別（AI・情報系／実証）に応じた観点を追加します。査読通過を保証するものではありません。",
    runsWhen: "本文生成後に自動実行（論文モードのみ）",
    genres: ["paper"],
    agentKey: "peer-review",
  },
```

`prompt-agent-fact-check` のエントリを変更（genres に paper 追加 + labelOverrides + description/runsWhen 更新）:

```ts
  {
    promptId: "prompt-agent-fact-check",
    staffLabel: "校閲（事実確認）",
    group: "review",
    kind: "staff",
    description:
      "本文中の事実主張を素材・一般知識と照合し、誤り・時代考証の違和感・要出典を検出します。実話ベースの原稿に必須。論文モードでは外部真偽の断定ではなく、本文内の主張・数字・因果関係の不自然さ検出が主目的です。",
    runsWhen: "本文生成後に自動実行（聞き書き・ビジネス書・ブログ・ニュース・論文。創作の小説では実行されない）",
    genres: ["biography", "business", "blog", "news", "paper"],
    labelOverrides: { paper: "校閲・本文内整合" },
    agentKey: "fact-check",
  },
```

`prompt-agent-logic` のエントリを変更:

```ts
  {
    promptId: "prompt-agent-logic",
    staffLabel: "論理構成チェック",
    group: "review",
    kind: "staff",
    description: "主張と根拠の対応、論理の飛躍、循環論法、過度な一般化を検出します。",
    runsWhen: "本文生成後に自動実行（ビジネス書・論文モード）",
    genres: ["business", "paper"],
    agentKey: "logic-check",
  },
```

`prompt-agent-citation` のエントリを変更:

```ts
  {
    promptId: "prompt-agent-citation",
    staffLabel: "出典チェック",
    group: "review",
    kind: "staff",
    description:
      "出典が必要な主張を検出し、参考文献ナレッジとの紐付け状況を確認します。論文モードでは引用マーカーと参考文献の突き合わせ・〔要出典〕の残存も確認します（文献の実在確認は行いません）。",
    runsWhen: "本文生成後に自動実行（ビジネス書・論文モード）",
    genres: ["business", "paper"],
    agentKey: "citation-check",
  },
```

- [ ] **Step 4: 古い「予定」文言の修正と planned からの削除**

`prompt-agent-omission` の runsWhen を変更: `"翻訳生成後に自動実行（翻訳書モード。論文モードでも流用予定）"` → `"翻訳生成後に自動実行（翻訳書モード）"`

`prompt-agent-terminology` の runsWhen も同様: `"翻訳生成後に自動実行（翻訳書モード。論文モードでも流用予定）"` → `"翻訳生成後に自動実行（翻訳書モード）"`

`plannedRiskStaff` から `{ label: "簡易査読", genres: "論文" },` の行を削除。

`plannedGenres` から以下のエントリを丸ごと削除:

```ts
  {
    label: "論文",
    status: "candidate",
    note: "IMRaD構成・簡易査読。日英翻訳は翻訳書モードのエンジン（翻訳者・訳抜け/用語統一チェック・対訳表）を流用予定",
  },
```

- [ ] **Step 5: agentLabel に genre 引数を追加**

既存の `agentLabel` を置き換え:

```ts
/** AgentKey → 表示ラベル（レビュー画面などで使用）。genre を渡すとジャンル別の表示名上書きが効く */
export function agentLabel(agentKey: string, genre?: Genre): string {
  const meta = staffRegistry.find((s) => s.agentKey === agentKey);
  if (!meta) return agentKey;
  if (genre && meta.labelOverrides?.[genre]) return meta.labelOverrides[genre]!;
  return meta.staffLabel;
}
```

- [ ] **Step 6: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラー0件

- [ ] **Step 7: Commit**

```bash
git add src/lib/staffRegistry.ts
git -c user.name="Will" -c user.email="tachiiri@westernavenu.com" commit -m "feat: 論文モードのAIスタッフ登録（簡易査読・流用3本・labelOverrides・ロードマップ更新）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: reviewers.ts + draft.ts（簡易査読 step・buildPaperContext・エージェント分岐）

**Files:**
- Modify: `src/workflows/agents/reviewers.ts`
- Modify: `src/workflows/draft.ts`

**Interfaces:**
- Consumes: Task 1 の `paperTypeLabel`（`@/lib/genreConfig`）と `Project.paperMeta`、Task 2 のプロンプト `prompt-agent-peer-review`（`{{paperContext}}` / `{{references}}` 変数）と fact-check / citation の `{{genreNote}}` 変数
- Produces: `export async function peerReviewStep(ctx: AgentContext, runId: string): Promise<AgentReportSummary>`（draft.ts が import する）

- [ ] **Step 1: reviewers.ts — serializePaperMeta と PEER_REVIEW を追加**

`import { newsTypeLabel } from "@/lib/genreConfig";`（309行付近）を変更:

```ts
import { newsTypeLabel, paperTypeLabel } from "@/lib/genreConfig";
```

`NEUTRALITY_CHECK` 定義の直後・`// ===== 翻訳書用 =====` セクションの前に追加:

```ts
// ===== 論文用: 簡易査読 =====

function serializePaperMeta(ctx: AgentContext): string {
  const m = ctx.project.paperMeta;
  if (!m) return "（論文仕様なし）";
  return [
    `論文種別: ${paperTypeLabel(m.paperType)}`,
    `分野: ${m.field || "未設定"}`,
    `リサーチクエスチョン・仮説: ${m.researchQuestion || "未設定"}`,
    `主張したい貢献・新規性: ${m.contributions || "未設定"}`,
    `想定投稿先・読者: ${m.venue || "未設定"}`,
    m.keywords ? `キーワード: ${m.keywords}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

const PEER_REVIEW: AgentDef = {
  key: "peer-review",
  label: "簡易査読",
  promptId: "prompt-agent-peer-review",
  buildVars: (ctx) => ({
    body: ctx.draft.body,
    chapterNumber: String(ctx.chapter?.chapterNumber ?? 0),
    chapterTitle: ctx.chapter?.title ?? ctx.draft.chapterTitle,
    sectionTitle: ctx.section?.title ?? ctx.draft.sectionTitle,
    paperContext: serializePaperMeta(ctx),
    references: serializeReferences(ctx),
  }),
};
```

※ `serializeReferences` は既存関数（196行付近・citation-check 用）をそのまま使う。

- [ ] **Step 2: reviewers.ts — fact-check / citation の buildVars に genreNote を追加**

`FACT_CHECK` の buildVars を変更:

```ts
const FACT_CHECK: AgentDef = {
  key: "fact-check",
  label: "校閲",
  promptId: "prompt-agent-fact-check",
  buildVars: (ctx) => ({
    body: ctx.draft.body,
    interviewNotes: (ctx.project.interviewNotes ?? "").slice(0, 8000),
    writingMemory: JSON.stringify(ctx.project.writingMemory ?? {}, null, 2),
    genreNote:
      ctx.project.genre === "paper"
        ? "【論文モードの注意】外部知識との真偽の断定ではなく、本文内の主張・数字・因果関係の不自然さ・矛盾の検出を主目的とすること（素材との照合が主、一般知識は従）。"
        : "",
  }),
};
```

`CITATION_CHECK` の buildVars を変更:

```ts
const CITATION_CHECK: AgentDef = {
  key: "citation-check",
  label: "出典",
  promptId: "prompt-agent-citation",
  buildVars: (ctx) => ({
    body: ctx.draft.body,
    references: serializeReferences(ctx),
    glossary: serializeGlossary(ctx),
    genreNote:
      ctx.project.genre === "paper"
        ? '【論文モードの追加確認】(1) 本文中の引用マーカー〔著者, 年〕が上の参考文献リストに存在するか突き合わせ、存在しない引用は severity="error" で指摘する。(2) 〔要出典〕が残っていれば出典の追加が必要として指摘する。(3) 文献の実在確認・外部DBとの照合は行わない。'
        : "",
  }),
};
```

- [ ] **Step 3: reviewers.ts — factCheckStep の表示名を論文モードで差し替え、peerReviewStep を追加**

既存の `factCheckStep` を置き換え:

```ts
export async function factCheckStep(
  ctx: AgentContext,
  runId: string,
): Promise<AgentReportSummary> {
  "use step";
  // 論文モード: 「事実確認」が外部真偽の保証と誤解されないよう表示名を差し替える（内部キーは不変）
  const def =
    ctx.project.genre === "paper" ? { ...FACT_CHECK, label: "校閲・本文内整合" } : FACT_CHECK;
  return runReviewer(def, ctx, runId);
}
```

`neutralityCheckStep` の直後（`// ===== 翻訳書専用 =====` の前）に追加:

```ts
// ===== 論文専用 =====

export async function peerReviewStep(
  ctx: AgentContext,
  runId: string,
): Promise<AgentReportSummary> {
  "use step";
  return runReviewer(PEER_REVIEW, ctx, runId);
}
```

ファイル先頭付近の `// ===== 翻訳書専用（論文モードでも流用予定） =====` コメント（626行付近）を `// ===== 翻訳書専用 =====` に、347行付近の `// （論文モードの日英翻訳でも流用予定。sourceText は Section.sourceText から取る）` を `// （sourceText は Section.sourceText から取る）` に修正。

- [ ] **Step 4: draft.ts — import と エージェント分岐を追加**

`./agents/reviewers` からの import（37行付近で終わる import 文）に `peerReviewStep` を追加。

`langLabel` を import している `@/lib/genreConfig` の import に `paperTypeLabel` を追加（draft.ts 内の既存 import 文を確認して追記。`newsTypeLabel, workTypeLabel, langLabel` 等と並んでいる）。

エージェント実行の分岐（80〜127行付近）を変更:

1. fact-check の条件（95〜102行付近）に paper を追加:

```ts
    // 実話・実用系 (聞き書き / ビジネス書 / ブログ / ニュース / 論文) は校閲 (事実確認) を追加。創作の小説では不要
    if (
      input.project.genre === "biography" ||
      input.project.genre === "business" ||
      input.project.genre === "blog" ||
      input.project.genre === "news" ||
      input.project.genre === "paper"
    ) {
      if (enabled("fact-check")) steps.push(factCheckStep(ctx, runId));
    }
```

2. ビジネス書専任の条件（119〜122行付近）を「ビジネス書・論文」に拡張:

```ts
    // ビジネス書・論文: 論理構成チェック + 出典チェック
    if (input.project.genre === "business" || input.project.genre === "paper") {
      if (enabled("logic-check")) steps.push(logicCheckStep(ctx, runId));
      if (enabled("citation-check")) steps.push(citationCheckStep(ctx, runId));
    }
    // 論文専任: 簡易査読
    if (input.project.genre === "paper") {
      if (enabled("peer-review")) steps.push(peerReviewStep(ctx, runId));
    }
```

- [ ] **Step 5: draft.ts — buildPaperContext を追加してジャンル分岐に接続**

`buildNewsContext` 関数の直後に追加:

```ts
// 論文: 論文仕様・参考文献・用語集を system prompt に注入する。
// 注入方針（設計書 §5）: PaperMeta は常時全文（短い固定サイズ）、references / glossary は
// 1行サマリの縮約のみ。原文や長文は入れない
function buildPaperContext(project: Project): string {
  const m = project.paperMeta;
  const refs = project.references ?? [];
  const terms = project.glossary ?? [];
  const parts: string[] = ["【論文モード：論文仕様】"];
  parts.push(
    [
      `- 論文種別: ${m ? paperTypeLabel(m.paperType) : "（未設定）"}`,
      `- 分野: ${m?.field || "（未設定）"}`,
      `- リサーチクエスチョン・仮説: ${m?.researchQuestion || "（未設定）"}`,
      `- 主張したい貢献・新規性: ${m?.contributions || "（未設定）"}`,
      `- 想定投稿先・読者: ${m?.venue || "（未設定）"}`,
      m?.keywords ? `- キーワード: ${m.keywords}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
  if (refs.length > 0) {
    parts.push("## 参考文献（登録済み。引用マーカー〔著者, 年〕はこのリストの文献のみに使うこと）");
    parts.push(
      refs
        .map(
          (r) =>
            `- ${r.title}${r.author ? ` / ${r.author}` : ""}${r.source ? `（${r.source}）` : ""}${
              r.year ? ` ${r.year}` : ""
            }${r.notes ? ` — ${r.notes}` : ""}`,
        )
        .join("\n"),
    );
  } else {
    parts.push(
      "## 参考文献\n（未登録。引用マーカー〔著者, 年〕は一切使わず、出典が必要な箇所は〔要出典〕とすること）",
    );
  }
  if (terms.length > 0) {
    parts.push("## 用語集（この定義に従って用語を使うこと）");
    parts.push(terms.map((t) => `- ${t.term}: ${t.definition}`).join("\n"));
  }
  parts.push(
    "\n【守るべきこと】\n" +
      "- 引用マーカー〔著者, 年〕は上記の参考文献にある文献のみに使う。無い場合は架空文献を作らず〔要出典〕と書く\n" +
      "- 素材にない結果・数値を書かない。不確かなものは factCheckPoints に挙げる\n" +
      "- 用語は用語集の定義と矛盾しない使い方をすること",
  );
  return parts.join("\n\n");
}
```

`draftStep` 内の genreContext の三項演算子チェーン（187〜200行付近）の `translation` 分岐の後に paper を追加:

```ts
  const genreContext =
    project.genre === "novel"
      ? buildNovelContext(project)
      : project.genre === "business"
        ? buildBusinessContext(project)
        : project.genre === "screenplay"
          ? buildScreenplayContext(project, section)
          : project.genre === "blog"
            ? buildBlogContext(project)
            : project.genre === "news"
              ? buildNewsContext(project)
              : project.genre === "translation"
                ? buildTranslationContext(project)
                : project.genre === "paper"
                  ? buildPaperContext(project)
                  : "";
```

`buildTranslationContext` の直前のコメント `// （論文モード実装時は workType="paper" の規律をそのまま流用する想定）` を `// （論文の翻訳も workType="paper" でこの規律に乗る）` に修正。

- [ ] **Step 6: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラー0件

- [ ] **Step 7: Commit**

```bash
git add src/workflows/agents/reviewers.ts src/workflows/draft.ts
git -c user.name="Will" -c user.email="tachiiri@westernavenu.com" commit -m "feat: 論文モードのワークフロー統合（簡易査読step・buildPaperContext・レビュアー分岐）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: UI（素材画面の論文パネル・staff/review の表示名）

**Files:**
- Modify: `src/app/page.tsx`（paperMeta 入力パネル）
- Modify: `src/app/staff/page.tsx`（labelOverrides の表示反映）
- Modify: `src/app/review/page.tsx`（agentLabel に genre を渡す）

**Interfaces:**
- Consumes: Task 1 の `PaperMeta` / `PaperType` / `PAPER_TYPE_OPTIONS`、Task 3 の `agentLabel(agentKey, genre?)` と `StaffMeta.labelOverrides`

- [ ] **Step 1: page.tsx — import と updatePaperField ヘルパを追加**

`@/lib/genreConfig` の import に `PAPER_TYPE_OPTIONS` を追加。`@/lib/types` の型 import に `PaperMeta` と `PaperType` を追加。

`updateField` 関数の直後に追加（news パネルの「全フィールドをその場で組み立てる」パターンは6フィールドでは冗長になるためヘルパ化。挙動は同じ）:

```tsx
  function updatePaperField(patch: Partial<PaperMeta>) {
    setProject((prev) => {
      if (!prev) return prev;
      const merged: PaperMeta = {
        paperType: prev.paperMeta?.paperType ?? "empirical",
        field: prev.paperMeta?.field ?? "",
        researchQuestion: prev.paperMeta?.researchQuestion ?? "",
        contributions: prev.paperMeta?.contributions ?? "",
        venue: prev.paperMeta?.venue ?? "",
        keywords: prev.paperMeta?.keywords,
        ...patch,
      };
      const next = { ...prev, paperMeta: merged };
      saveProject(next);
      return next;
    });
  }
```

- [ ] **Step 2: page.tsx — 論文パネルを追加**

news パネル（`{project.genre === "news" ? (...) : null}`）の直後・翻訳パネル（`{isTranslation ? (...)`）の前に追加:

```tsx
          {project.genre === "paper" ? (
            <>
              <div className="field-row">
                <div className="field">
                  <label htmlFor="paper-type">論文種別</label>
                  <select
                    id="paper-type"
                    className="input"
                    value={project.paperMeta?.paperType ?? "empirical"}
                    onChange={(e) => updatePaperField({ paperType: e.target.value as PaperType })}
                  >
                    {PAPER_TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  <p className="help">
                    種別で構成の流儀が切り替わります（AI・情報系＝序論→関連研究→提案手法→実験）。
                  </p>
                </div>
                <div className="field">
                  <label htmlFor="paper-field">分野</label>
                  <input
                    id="paper-field"
                    type="text"
                    className="input"
                    value={project.paperMeta?.field ?? ""}
                    onChange={(e) => updatePaperField({ field: e.target.value })}
                    placeholder="例：教育学 / 自然言語処理"
                  />
                </div>
              </div>
              <div className="field-row">
                <div className="field">
                  <label htmlFor="paper-rq">リサーチクエスチョン・仮説</label>
                  <input
                    id="paper-rq"
                    type="text"
                    className="input"
                    value={project.paperMeta?.researchQuestion ?? ""}
                    onChange={(e) => updatePaperField({ researchQuestion: e.target.value })}
                    placeholder="この研究で何を明らかにするか"
                  />
                </div>
                <div className="field">
                  <label htmlFor="paper-contrib">主張したい貢献・新規性</label>
                  <input
                    id="paper-contrib"
                    type="text"
                    className="input"
                    value={project.paperMeta?.contributions ?? ""}
                    onChange={(e) => updatePaperField({ contributions: e.target.value })}
                    placeholder="先行研究に対して何が新しいか"
                  />
                </div>
              </div>
              <div className="field-row">
                <div className="field">
                  <label htmlFor="paper-venue">想定投稿先・読者</label>
                  <input
                    id="paper-venue"
                    type="text"
                    className="input"
                    value={project.paperMeta?.venue ?? ""}
                    onChange={(e) => updatePaperField({ venue: e.target.value })}
                    placeholder="例：紀要 / 学会誌 / 一般向け学術書"
                  />
                  <p className="help">
                    投稿先で文体・構成の書き分けが変わります。参考文献は{" "}
                    <Link href="/references">参考文献・用語集</Link> で登録すると引用と出典チェックに使われます。
                  </p>
                </div>
                <div className="field">
                  <label htmlFor="paper-keywords">キーワード（任意）</label>
                  <input
                    id="paper-keywords"
                    type="text"
                    className="input"
                    value={project.paperMeta?.keywords ?? ""}
                    onChange={(e) => updatePaperField({ keywords: e.target.value })}
                    placeholder="例：大規模言語モデル, 教育評価, 自動採点"
                  />
                </div>
              </div>
            </>
          ) : null}
```

- [ ] **Step 3: staff ページ — labelOverrides を表示に反映**

`src/app/staff/page.tsx` の 195行付近 `<strong>{meta.staffLabel}</strong>` を変更（同ページには 36行に `const genre = project?.genre ?? "biography";` が既にある）:

```tsx
                        <strong>{meta.labelOverrides?.[genre] ?? meta.staffLabel}</strong>
```

- [ ] **Step 4: review ページ — agentLabel に genre を渡す**

`src/app/review/page.tsx` の2箇所（97行付近と215行付近）の `agentLabel(r.agent)` を `agentLabel(r.agent, project?.genre)` に変更（同ページには 43行に `project` state が既にある。useMemo の依存配列に project が含まれているかを確認し、含まれていなければ追加する — 97行の useMemo は `[project]` 依存が既にあるはず。念のため確認）。

※ AgentReportSummary.label（実行時に保存された表示名）が優先される既存ロジック `r.label || agentLabel(...)` は変えない。Task 4 の factCheckStep が論文モードでは label="校閲・本文内整合" を保存するので、新規レポートは自動で正しい表示になる。agentLabel の genre 引数は label 未保存の古いレポートのフォールバック用。

- [ ] **Step 5: 型チェックとビルド**

Run: `npx tsc --noEmit`
Expected: エラー0件

Run: `npx next build`
Expected: ビルド成功（全ページ静的解析が通る）

- [ ] **Step 6: Commit**

```bash
git add src/app/page.tsx src/app/staff/page.tsx src/app/review/page.tsx
git -c user.name="Will" -c user.email="tachiiri@westernavenu.com" commit -m "feat: 論文モードのUI（素材画面の論文仕様パネル・ジャンル別スタッフ表示名）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: 残骸チェック + HANDOFF.md 更新

**Files:**
- Modify: `HANDOFF.md`
- Modify: grep で見つかった古い「予定」表示があれば該当ファイル

**Interfaces:**
- Consumes: Task 1〜5 の完了状態（ドキュメントが実装を正しく記述するため）

- [ ] **Step 1: 古い「論文＝予定」文言の残骸を検索**

Run: `grep -rn "論文" src --include="*.ts" --include="*.tsx" | grep -v "論文モード用\|論文モードの\|（論文モード）\|論文モードのみ\|論文仕様\|論文タイトル\|論文構成\|論文の構成\|論文種別\|学術論文\|論文専\|論文・学術\|・論文"`
Expected: 「予定」「今後」「検討中」を含む行が**残っていない**こと。残っていたら（Task 3 の staffRegistry 修正漏れ、/settings や /guide の文言等）該当箇所を実装済みの記述に修正する。

Run: `grep -rn "流用予定\|対応予定" src --include="*.ts" --include="*.tsx"`
Expected: 論文に関する「予定」が残っていないこと（翻訳書モードの「他言語は今後追加予定」は対象外・残してよい）

- [ ] **Step 2: HANDOFF.md を更新**

以下を反映する:

1. 「7ジャンルと専任エージェント」の表を「8ジャンル」に変え、行を追加:

```markdown
| paper（論文） | 研究素材 | 参考文献・用語集(/references流用) | 簡易査読/論理構成/出典/校閲・本文内整合 |
```

2. 表の下の共通レビュアー説明の後に1行追加:

```markdown
論文の引用安全ルール: 引用マーカー〔著者, 年〕は references 登録文献のみ。無ければ〔要出典〕（架空文献の生成禁止）。
```

3. 「最近の実装（新しい順）」の先頭に追加:

```markdown
0. **論文モード**（2026-07-13）: paper（IMRaD/AI・情報系/総説/人文社会の構成分岐、簡易査読、
   引用安全ルール、fact-check は「校閲・本文内整合」に表示名切替）。
   設計書: `docs/superpowers/specs/2026-07-13-paper-mode-design.md`
```

（既存の 0. ニュース+翻訳の項は 1. に、以降の番号を1つずつ繰り下げる）

4. 「次にやる候補（ロードマップ）」から `- **論文モード**（検討中。...）` の行を削除。

5. 「翻訳書モードの特記事項（論文モードへの布石）」の見出しを「翻訳書モードの特記事項」に変え、`**workType="paper" が将来の論文モードの翻訳の入口**` を `**論文の翻訳は workType="paper" でこのエンジンに乗る**（論文モード本体は執筆専念）` に変更。同節末尾の「シリーズ物と論文モードの分野術語集の使い回しが狙い」はそのまま（実装済みの記述として正しい）。

6. 最終更新日を `2026-07-13` に変更。

- [ ] **Step 3: Commit**

```bash
git add HANDOFF.md src
git -c user.name="Will" -c user.email="tachiiri@westernavenu.com" commit -m "docs: HANDOFF を8ジャンル体制に更新（論文モード実装済み・ロードマップ整理）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: ブラウザ検証（paper 通し・引用安全・回帰・旧プロジェクト）

**Files:** なし（検証のみ。問題が見つかったら該当タスクのファイルを修正して追加コミット）

**Interfaces:**
- Consumes: Task 1〜6 のすべて

- [ ] **Step 1: ビルドと dev サーバ起動**

Run: `npx tsc --noEmit && npx next build`
Expected: 両方成功

dev サーバはブラウザプレビュー用ツール（.claude/launch.json の設定、なければ `npm run dev` を launch.json に登録）で起動する。`.env.local` に `ANTHROPIC_API_KEY` が必要（HANDOFF 参照）。

- [ ] **Step 2: paper 通し確認**

1. `/` でモードを「論文」に切り替え → 論文仕様パネル（種別・分野・RQ・貢献・投稿先・キーワード）が表示されること
2. 素材パネルのタイトルが「研究素材」、help に「査読通過や学術的妥当性を保証するものではありません」が出ること
3. paperType=「原著（実証・IMRaD）」のまま、研究素材にサンプル（例: 架空の教育実験メモ・結果数値を数行）を貼り「章立て案を生成する」→ 3案の型ラベルが「IMRaD・実証型／総説・レビュー型／人文社会・章立て型」で、第1案が IMRaD 型であること。各章 summary の冒頭に【役割: …】タグが付くこと
4. 1案選択 → 節展開 → /writer で1節の本文生成 → 自動レビューに「簡易査読」「論理構成」「出典」「校閲・本文内整合」（+共通4本）が並ぶこと。簡易査読の findings に【総評】が含まれること
5. /review にレポートが集約され、タブの表示名が「校閲・本文内整合」になっていること
6. /staff で論文モードのスタッフ一覧に簡易査読が出て、fact-check の表示名が「校閲・本文内整合」であること。「今後対応予定」欄に論文・簡易査読が**残っていない**こと（/settings のロードマップも同様）

- [ ] **Step 3: 引用安全ルールの確認**

参考文献（/references）を**登録しない**状態で本文を生成し、本文に〔著者, 年〕形式の引用マーカーが**出ない**こと（出典が必要な箇所は〔要出典〕になる）を確認する。〔要出典〕が出た場合、出典チェックの findings で指摘されることも確認する。

- [ ] **Step 4: paperType=ai-cs の確認**

論文種別を「AI・情報系」に変えて構成案を再生成 → 第1案の章立てが「序論→関連研究→提案手法→実験・評価→考察→結論」系の CS 流儀になること。

- [ ] **Step 5: 既存ジャンルの回帰確認（smoke test）**

今回分岐を触った2ジャンルを確認:
1. **ビジネス書**: モードをビジネス書に切り替え → 構成案生成 → 本文生成 → 論理構成・出典・校閲（表示名は「校閲」のまま＝labelOverrides が誤発動していない）が従来通り動くこと
2. **ニュース記事**: モードをニュースに切り替え → newsMeta パネルが従来通り表示され、構成案生成が動くこと

- [ ] **Step 6: 旧プロジェクトの読込確認**

/settings の JSON エクスポートで現プロジェクトを書き出し、JSON から `paperMeta` キーを削除したものをインポート → エラーなく開け、モードを論文に切り替えると論文仕様パネルが空（デフォルト値）で表示されること。

- [ ] **Step 7: 検証結果の記録**

問題が見つかった場合は該当ファイルを修正し、`fix:` プレフィックスでコミット。全項目パスしたら検証結果（確認項目と結果）をユーザーに報告する。

---

## Self-Review（実施済み）

- **Spec coverage**: 設計書 §1（genreConfig）→Task 1 / §2（PaperMeta・実用分類・keywords）→Task 1, 5 / §3（3案・第1案整合・役割タグ）→Task 2 / §4（プロンプト4本・paperType別観点・出力形式・引用安全・流用3本・labelOverrides・自動実行の維持）→Task 2, 3, 4 / §5（buildPaperContext 縮約方針）→Task 4 / §6（後方互換・残骸チェック）→Task 1, 6 / §7（触るファイル）→全タスク / §8（YAGNI: methodology 未実装・PaperSectionRole 型化なし・ReviewSeverity なし・手動レビューなし）→どのタスクにも含まれないことを確認 / §9（検証）→Task 7
- **Type consistency**: `PaperMeta.keywords?: string`（optional）を genreConfig の extraContext・reviewers の serializePaperMeta・draft の buildPaperContext・page.tsx の updatePaperField すべてで optional 扱いに統一。`peerReviewStep` の名前は Task 4 定義と draft.ts import で一致。`agentLabel(agentKey, genre?)` は第2引数 optional のため既存呼び出しと互換
- **Placeholder scan**: TBD/TODO なし。全コードステップに実コードを記載
