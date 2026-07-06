import type { Genre } from "./types";

/**
 * GenreConfig — ジャンル＝パイプラインのプリセット。
 *
 * 設計原則:
 *   - ナビの骨格 (01素材 → 02構成 → 03執筆 → 04レビュー) は全ジャンル固定
 *   - 各ステージのラベル・説明・ナレッジ項目・placeholder はジャンルで差し替える
 *   - 新ジャンル追加 = ここに config を足す + プロンプトを足す（画面コードは触らない）
 *
 * 概念の3分類 (混ぜないこと):
 *   - AIスタッフ    = 実行される役割 (staffRegistry.ts)
 *   - ナレッジ      = 参照される材料 (このファイルの knowledge)
 *   - ルールブック  = 各スタッフに注入される編集方針 (staffRegistry の kind:"rulebook")
 */

export type StageKey = "material" | "structure" | "writing" | "review";

export type StageConfig = {
  navLabel: string;   // ナビ表示 (素材 / 構成 / 執筆 / レビュー)
  pageTitle: string;  // 画面タイトル
  description: string; // 画面サブタイトル
};

export type KnowledgeItem = {
  href: string;
  label: string;
};

export type GenreConfig = {
  genre: Genre;
  label: string;
  stages: Record<StageKey, StageConfig>;
  knowledge: KnowledgeItem[];
  material: {
    panelTitle: string;
    placeholder: string;
    help: string;
    subjectLabel: string; // 「取材対象者名」/「主人公名」/「著者名」
  };
  /** このジャンルのパイプラインが使うプロンプト id */
  pipelinePrompts: {
    outline: string;
    sections: string;
    draft: string;
  };
  /** 構成案3案の型ラベル (未指定なら聞き書きのデフォルト) */
  outlineTypeLabels?: Record<"chronological" | "thematic" | "narrative", string>;
};

export const biographyConfig: GenreConfig = {
  genre: "biography",
  label: "聞き書き",
  stages: {
    material: {
      navLabel: "素材",
      pageTitle: "取材メモ入力",
      description: "取材で聞いた内容を貼り付け、章立て案を生成します。",
    },
    structure: {
      navLabel: "構成",
      pageTitle: "章立て構成案",
      description: "AIが提示した構成案から方向性を選びます。",
    },
    writing: {
      navLabel: "執筆",
      pageTitle: "原稿生成",
      description: "選択した構成案をもとに、小見出し単位で本文を生成します。",
    },
    review: {
      navLabel: "レビュー",
      pageTitle: "編集レビュー",
      description: "AI編集部の診断結果を集約して確認します。",
    },
  },
  knowledge: [
    { href: "/memory", label: "執筆メモリ" },
    { href: "/library", label: "参照ライブラリ" },
  ],
  material: {
    panelTitle: "取材メモ",
    placeholder: "取材で聞き取った内容を、箇条書き／自由記述どちらでも貼り付けてください。",
    help: "事実関係のみで構いません。整形・要約はAIが行います。個人を特定する情報は事前にマスキングしてください。長さの目安は 20,000 字以内。40,000 字を超えるとサーバタイムアウト（最大 180 秒）に達する可能性があります。",
    subjectLabel: "取材対象者名",
  },
  pipelinePrompts: {
    outline: "prompt-outline",
    sections: "prompt-sections",
    draft: "prompt-draft",
  },
};

export const novelConfig: GenreConfig = {
  genre: "novel",
  label: "小説",
  stages: {
    material: {
      navLabel: "素材",
      pageTitle: "プロット素材",
      description: "基本プロット、場面案、キャラクターの種を整理し、章立て案を生成します。",
    },
    structure: {
      navLabel: "構成",
      pageTitle: "章・シーン構成",
      description: "物語を章とシーンに分解します。",
    },
    writing: {
      navLabel: "執筆",
      pageTitle: "本文執筆",
      description: "シーン単位で本文を生成・編集します。",
    },
    review: {
      navLabel: "レビュー",
      pageTitle: "読者体験・整合性レビュー",
      description: "退屈さ、感情移入、キャラの一貫性、矛盾を確認します。",
    },
  },
  knowledge: [
    { href: "/characters", label: "登場人物" },
    { href: "/relations", label: "人物相関図" },
    { href: "/bible", label: "Story Bible" },
    { href: "/memory", label: "執筆メモリ" },
    { href: "/library", label: "参照ライブラリ" },
  ],
  material: {
    panelTitle: "プロット / 素材メモ",
    placeholder:
      "物語のあらすじ、書きたいシーン、主人公の背景、対立構造、テーマなどを自由に入力してください。取材や実話ベースの素材でも構いません。",
    help: "プロット・設定・シーン案などをまとめて投入できます。この内容と、ナレッジ（登場人物 / Story Bible）に登録した情報を合わせて AI が章立て → 本文を組み立てます。",
    subjectLabel: "主人公名 / モデル",
  },
  pipelinePrompts: {
    outline: "prompt-outline",
    sections: "prompt-sections",
    draft: "prompt-draft",
  },
};

export const businessConfig: GenreConfig = {
  genre: "business",
  label: "ビジネス書",
  stages: {
    material: {
      navLabel: "素材",
      pageTitle: "取材・リサーチ素材",
      description: "主張の種・データ・事例を整理し、章立て案を生成します。",
    },
    structure: {
      navLabel: "構成",
      pageTitle: "章立て・論理構成",
      description: "読者課題起点／フレームワーク／ストーリーの3案から方向性を選びます。",
    },
    writing: {
      navLabel: "執筆",
      pageTitle: "執筆",
      description: "節単位で「主張→根拠→事例→まとめ」の本文を生成します。",
    },
    review: {
      navLabel: "レビュー",
      pageTitle: "論理・出典レビュー",
      description: "論理の飛躍・要出典・事実確認を集約して確認します。",
    },
  },
  knowledge: [
    { href: "/references", label: "参考文献・用語集" },
    { href: "/memory", label: "執筆メモリ" },
    { href: "/library", label: "参照ライブラリ" },
  ],
  material: {
    panelTitle: "取材・リサーチ素材",
    placeholder:
      "書きたいテーマ、主張の種、取材メモ、データや事例、参考にしたい書籍・記事などを自由に入力してください。",
    help: "主張・根拠・事例の素材をまとめて投入できます。参考文献・用語集をナレッジに登録すると、執筆と出典チェックに反映されます。",
    subjectLabel: "著者名 / 監修者名",
  },
  pipelinePrompts: {
    outline: "prompt-outline-business",
    sections: "prompt-sections-business",
    draft: "prompt-draft-business",
  },
  outlineTypeLabels: {
    chronological: "読者課題起点型",
    thematic: "フレームワーク型",
    narrative: "ストーリー型",
  },
};

export const screenplayConfig: GenreConfig = {
  genre: "screenplay",
  label: "脚本",
  stages: {
    material: {
      navLabel: "素材",
      pageTitle: "ログライン・素材",
      description: "ログライン・テーマ・モチーフを整理し、幕構成（ハコ書きの骨格）を生成します。",
    },
    structure: {
      navLabel: "構成",
      pageTitle: "ハコ書き（シーン構成）",
      description: "物語を幕・シークエンス・シーンに分解し、尺を配分します。",
    },
    writing: {
      navLabel: "執筆",
      pageTitle: "ト書き・セリフ執筆",
      description: "シーン単位で柱・ト書き・セリフの脚本本文を生成します。",
    },
    review: {
      navLabel: "レビュー",
      pageTitle: "フォーマット・尺レビュー",
      description: "脚本形式の逸脱・尺の乖離・テンポの停滞を集約して確認します。",
    },
  },
  knowledge: [
    { href: "/board", label: "シーンボード・香盤表" },
    { href: "/characters", label: "登場人物" },
    { href: "/relations", label: "人物相関図" },
    { href: "/bible", label: "設定・ロケーション" },
    { href: "/memory", label: "執筆メモリ" },
    { href: "/library", label: "参照ライブラリ" },
  ],
  material: {
    panelTitle: "ログライン・素材",
    placeholder:
      "ログライン（主人公が◯◯するために△△する話）、テーマ、モチーフ、主要な場面のアイデア、参考作品などを自由に入力してください。",
    help: "メディア種別と目標尺を設定すると、幕構成と各シーンの尺配分に反映されます。登場人物・ロケーションはナレッジに登録すると執筆とチェックに使われます。",
    subjectLabel: "主人公名",
  },
  pipelinePrompts: {
    outline: "prompt-outline-screenplay",
    sections: "prompt-sections-screenplay",
    draft: "prompt-draft-screenplay",
  },
  outlineTypeLabels: {
    chronological: "三幕構成型",
    thematic: "シークエンス型",
    narrative: "群像・ノンリニア型",
  },
};

export const blogConfig: GenreConfig = {
  genre: "blog",
  label: "ブログ記事",
  stages: {
    material: {
      navLabel: "素材",
      pageTitle: "ネタ・キーワード",
      description: "キーワード・検索意図・ネタを整理し、見出し構成案を生成します。",
    },
    structure: {
      navLabel: "構成",
      pageTitle: "見出し構成",
      description: "検索意図をカバーする H2/H3 見出しの構成を選びます。",
    },
    writing: {
      navLabel: "執筆",
      pageTitle: "本文執筆",
      description: "見出し単位で、結論先出し・視点入りの本文を生成します。",
    },
    review: {
      navLabel: "レビュー",
      pageTitle: "SEO・ファクトレビュー",
      description: "検索意図の充足・見出し・薄い内容・事実確認を集約して確認します。",
    },
  },
  knowledge: [
    { href: "/seo", label: "キーワード・ペルソナ" },
    { href: "/memory", label: "執筆メモリ" },
    { href: "/library", label: "参照ライブラリ" },
  ],
  material: {
    panelTitle: "ネタ・素材メモ",
    placeholder:
      "記事のテーマ、伝えたい主張、盛り込みたいネタ、一次情報・体験・データ、参考にしたい記事などを自由に入力してください。",
    help: "ネタと素材を投入し、キーワード・ペルソナ（ナレッジ）を設定すると、検索意図に沿った構成と本文が生成されます。",
    subjectLabel: "執筆者・メディア名",
  },
  pipelinePrompts: {
    outline: "prompt-outline-blog",
    sections: "prompt-sections-blog",
    draft: "prompt-draft-blog",
  },
  outlineTypeLabels: {
    chronological: "ハウツー・手順型",
    thematic: "比較・まとめ型",
    narrative: "体験・オピニオン型",
  },
};

export const newsConfig: GenreConfig = {
  genre: "news",
  label: "ニュース記事",
  stages: {
    material: {
      navLabel: "素材",
      pageTitle: "取材素材・一次情報",
      description: "取材メモ・発表資料・一次情報を整理し、記事構成案を生成します。",
    },
    structure: {
      navLabel: "構成",
      pageTitle: "記事構成",
      description: "逆ピラミッド／解説Q&A／ルポ・特集の3案から方向性を選びます。",
    },
    writing: {
      navLabel: "執筆",
      pageTitle: "記事執筆",
      description: "ブロック単位で、リード先行・事実と論評を分離した本文を生成します。",
    },
    review: {
      navLabel: "レビュー",
      pageTitle: "報道品質レビュー",
      description: "見出し・リードの整合、中立性、事実確認を集約して確認します。",
    },
  },
  knowledge: [
    { href: "/references", label: "取材源・出典" },
    { href: "/memory", label: "執筆メモリ" },
    { href: "/library", label: "参照ライブラリ" },
  ],
  material: {
    panelTitle: "取材素材・一次情報",
    placeholder:
      "取材メモ、発表資料・プレスリリースの要点、当事者コメント、数値・日時・場所などの一次情報を貼り付けてください。",
    help: "5W1Hが分かる素材ほど精度が上がります。出典・取材源はナレッジ（取材源・出典）に登録すると、本文と出典チェックに反映されます。",
    subjectLabel: "記者名／媒体名",
  },
  pipelinePrompts: {
    outline: "prompt-outline-news",
    sections: "prompt-sections-news",
    draft: "prompt-draft-news",
  },
  outlineTypeLabels: {
    chronological: "逆ピラミッド型（ストレート）",
    thematic: "解説・Q&A型",
    narrative: "ルポ・特集型",
  },
};

export const translationConfig: GenreConfig = {
  genre: "translation",
  label: "翻訳書",
  stages: {
    material: {
      navLabel: "原文",
      pageTitle: "原文取り込み",
      description: "Word / PDF / テキストを取り込み、章とセグメントに分割します。",
    },
    structure: {
      navLabel: "構成",
      pageTitle: "章・セグメント構成",
      description: "原文の章立てを確認します（分割は原文取り込み画面で行います）。",
    },
    writing: {
      navLabel: "翻訳",
      pageTitle: "翻訳",
      description: "セグメント単位で翻訳し、対訳・差分ビューで確認します。",
    },
    review: {
      navLabel: "レビュー",
      pageTitle: "翻訳レビュー",
      description: "訳抜け・用語統一・表記揺れの診断を集約して確認します。",
    },
  },
  knowledge: [
    { href: "/terms", label: "対訳表・用語" },
    { href: "/memory", label: "執筆メモリ" },
    { href: "/library", label: "参照ライブラリ" },
  ],
  material: {
    panelTitle: "原文テキスト",
    placeholder:
      "原文（英語または日本語）を貼り付けるか、上のファイル取り込みで Word / PDF を読み込んでください。",
    help: "取り込んだ原文は「章に分割」で章・セグメントに分けてから翻訳します。原文ファイル自体は保存されず、テキストのみプロジェクトに保持されます。",
    subjectLabel: "原著者名",
  },
  // 翻訳書は構成をAIで生成しない（原文構造から決定論的に組み立てる）。
  // outline / sections の id は未使用だが型上必要なので汎用を指す。
  pipelinePrompts: {
    outline: "prompt-outline",
    sections: "prompt-sections",
    draft: "prompt-draft-translation",
  },
};

const registry: Record<Genre, GenreConfig> = {
  biography: biographyConfig,
  novel: novelConfig,
  business: businessConfig,
  screenplay: screenplayConfig,
  blog: blogConfig,
  news: newsConfig,
  translation: translationConfig,
};

// ===== 脚本: メディア種別のプリセット =====

export const MEDIA_TYPE_OPTIONS: {
  value: import("./types").ScreenplayMediaType;
  label: string;
  defaultMinutes: number;
}[] = [
  { value: "film", label: "映画（長編）", defaultMinutes: 110 },
  { value: "short", label: "短編", defaultMinutes: 15 },
  { value: "tv-drama", label: "連続ドラマ（1話）", defaultMinutes: 45 },
  { value: "stage", label: "舞台", defaultMinutes: 120 },
];

export function mediaTypeLabel(v: string | undefined): string {
  return MEDIA_TYPE_OPTIONS.find((o) => o.value === v)?.label ?? "映画（長編）";
}

// ===== ニュース: 記事種別のプリセット =====

export const NEWS_TYPE_OPTIONS: {
  value: import("./types").NewsType;
  label: string;
}[] = [
  { value: "straight", label: "ストレートニュース" },
  { value: "explainer", label: "解説記事" },
  { value: "feature", label: "特集・ルポ" },
  { value: "interview", label: "インタビュー" },
];

export function newsTypeLabel(v: string | undefined): string {
  return NEWS_TYPE_OPTIONS.find((o) => o.value === v)?.label ?? "ストレートニュース";
}

// ===== 翻訳書: 言語・原文種別のプリセット =====

/** 対応言語。将来 es / zh / ko / fr / de を追加するときはここに足すだけでUIに反映される */
export const LANGUAGE_OPTIONS: { value: import("./types").LangCode; label: string }[] = [
  { value: "en", label: "英語" },
  { value: "ja", label: "日本語" },
];

export function langLabel(v: string | undefined): string {
  return LANGUAGE_OPTIONS.find((o) => o.value === v)?.label ?? v ?? "英語";
}

export const WORK_TYPE_OPTIONS: {
  value: import("./types").TranslationWorkType;
  label: string;
}[] = [
  { value: "book", label: "書籍（実用・ノンフィクション）" },
  { value: "paper", label: "論文・学術" },
  { value: "fiction", label: "創作・フィクション" },
  { value: "article", label: "記事・ドキュメント" },
];

export function workTypeLabel(v: string | undefined): string {
  return WORK_TYPE_OPTIONS.find((o) => o.value === v)?.label ?? "書籍（実用・ノンフィクション）";
}

/**
 * ジャンル固有の extraContext (outline / sections 生成の user prompt に付与)。
 * 脚本: メディア種別・目標尺 / ブログ: キーワード・検索意図・ペルソナ。
 * 対象外ジャンルでは空文字を返す。
 * (関数名は歴史的経緯で screenplay 由来だが全ジャンル共通のディスパッチャ)
 */
export function buildScreenplayExtraContext(p: {
  genre?: string;
  screenplayMeta?: { mediaType: string; targetRuntimeMinutes: number };
  blogMeta?: {
    targetKeyword?: string;
    secondaryKeywords?: string[];
    searchIntent?: string;
    persona?: string;
  };
  newsMeta?: {
    outlet?: string;
    newsType?: string;
    angle?: string;
    audience?: string;
  };
}): string {
  if (p.genre === "screenplay" && p.screenplayMeta) {
    return `【作品仕様】\nメディア種別: ${mediaTypeLabel(p.screenplayMeta.mediaType)}\n目標尺: ${p.screenplayMeta.targetRuntimeMinutes}分`;
  }
  if (p.genre === "blog" && p.blogMeta) {
    const m = p.blogMeta;
    return (
      "【SEO・読者設定】\n" +
      `対策キーワード: ${m.targetKeyword || "（未設定）"}\n` +
      (m.secondaryKeywords?.length ? `関連キーワード: ${m.secondaryKeywords.join("、")}\n` : "") +
      `検索意図: ${m.searchIntent || "（未設定）"}\n` +
      `想定読者（ペルソナ）: ${m.persona || "（未設定）"}`
    );
  }
  if (p.genre === "news" && p.newsMeta) {
    const m = p.newsMeta;
    return (
      "【記事仕様】\n" +
      `想定媒体: ${m.outlet || "（未設定）"}\n` +
      `記事種別: ${newsTypeLabel(m.newsType)}\n` +
      `切り口・アングル: ${m.angle || "（未設定）"}\n` +
      `想定読者: ${m.audience || "（未設定）"}`
    );
  }
  return "";
}

export function getGenreConfig(genre: Genre | undefined | null): GenreConfig {
  return registry[genre ?? "biography"] ?? biographyConfig;
}

export const allGenres: GenreConfig[] = Object.values(registry);
