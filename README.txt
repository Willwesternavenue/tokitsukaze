仕様書：自費出版向け「聞き書き出版AI」デモアプリ
1. 目的

自費出版会社向けに、取材者がヒアリングした内容をもとに、AIが本・記事の構成案、本文初稿、編集メモ、追加質問を生成するデモアプリを作成する。

本アプリは完成版ではなく、今日の商談・提案デモで見せることを目的とする。
そのため、ユーザー認証や本格的なDBは不要とし、Next.js + Vercel で簡単に動作する構成とする。

2. 想定ユーザー
自費出版会社の社長
取材者
編集者
ライター
ゴーストライター
3. デモで見せたい体験

ユーザーは以下の流れで操作できる。

取材メモを入力する
AIが章立て構成案を複数提示する
ユーザーが構成案を選択する
選択した構成案をもとに、章・小見出し一覧を生成する
小見出しをクリックすると、その部分の本文をAIが生成する
生成結果には、本文だけでなく編集メモ・追加質問・事実確認ポイントも含める
生成した内容をWordファイルとして保存できる
プロンプト保存画面で、AIへの指示テンプレートを編集・保存できる
基本情報・執筆メモリ画面で、人物情報、年表、文体ルール、重要発言などを保存できる
4. 技術構成
フロントエンド
Next.js
TypeScript
App Router
React
CSS Modules または Tailwind CSS

見た目は高級感よりも、業務ツールとしてわかりやすいUIを優先する。

デプロイ
Vercel
AI API

以下のどちらかを使えるようにする。

OpenAI API
Anthropic Claude API

まずは .env.local でどちらか一方を使えればよい。

OPENAI_API_KEY=xxxxx
ANTHROPIC_API_KEY=xxxxx
AI_PROVIDER=openai

AI_PROVIDER が openai の場合はOpenAI、anthropic の場合はClaudeを使う。

デモでは、どちらか一方だけの実装でも可。
ただし、コード上は後で切り替えやすいように関数を分けておく。

データ保存

今日のデモではDBは使わない。

以下は localStorage に保存する。

取材メモ
選択した構成案
基本情報・執筆メモリ
プロンプトテンプレート
生成済み本文
章・小見出し構成

将来的にSupabaseへ移行しやすいよう、データ構造はJSONとして整理する。

Word出力

.docx 出力に対応する。

使用候補ライブラリ：

npm install docx file-saver

Word出力ボタンを押すと、生成済みの本文・構成案・編集メモを .docx として保存できる。

5. 画面構成
5.1 ホーム画面 / 取材メモ入力画面

URL：

/
目的

取材者がヒアリング内容を貼り付ける画面。

表示項目
プロジェクト名
取材対象者名
取材メモ入力欄
本にしたいテーマ
想定読者
文体の希望
章立て構成案を生成するボタン
入力例
対象者：70代男性。
地方で小さな印刷会社を経営していた。
若い頃は東京で働いていたが、父の病気をきっかけに帰郷。
バブル崩壊後、仕事が激減し、借金も抱えた。
しかし地域の商店街のチラシ制作を続け、地元との信頼関係を築いた。
本人は「派手な成功ではないが、逃げなかったことだけは誇れる」と話している。
ボタン
章立て案を生成する

押下するとAI APIを呼び出し、構成案を3案生成する。

5.2 章立て構成案画面

URL：

/outline
目的

AIが生成した複数の章立て案を比較し、編集者が方向性を選択する。

表示項目

構成案を3種類表示する。

構成案A：時系列型
構成案B：テーマ型
構成案C：人物伝・読み物型

各構成案には以下を含める。

type OutlineProposal = {
  id: string;
  title: string;
  concept: string;
  recommendedFor: string;
  chapters: {
    chapterNumber: number;
    title: string;
    summary: string;
  }[];
};
表示例
構成案A：時系列型

コンセプト：
人生の流れに沿って、読者が自然に人物の歩みを追える構成。

おすすめ用途：
自分史、社史、家族向け出版。

第1章　東京での修業時代
第2章　父の病と帰郷
第3章　家業を継ぐという決断
第4章　バブル崩壊と経営危機
第5章　地域に支えられた印刷会社
第6章　逃げなかった人生
ボタン

各構成案に以下のボタンを付ける。

この構成案で進める

選択すると、構成案を保存し、章・小見出し生成へ進む。

5.3 原稿生成画面

URL：

/writer
目的

選択した構成案をもとに、各章・各小見出し単位で本文を生成する。

レイアウト

2カラム構成。

左側：

選択済みの章立て
各章の小見出し一覧
クリック可能な小見出し

右側：

生成された本文
編集メモ
追加質問
事実確認ポイント
Word出力ボタン
左カラム例
第1章　東京での修業時代
  - 東京で見た夢
  - 若き日の仕事
  - 故郷からの知らせ

第2章　父の病と帰郷
  - 帰郷を決めた日
  - 家族との対話
  - 印刷会社の現実
小見出しクリック時の動作

小見出しをクリックすると、AI APIへ以下の情報を渡す。

取材メモ
基本情報・執筆メモリ
選択済み構成案
該当章情報
該当小見出し
これまでに生成した章の要約
プロンプトテンプレート

AIは以下を返す。

type SectionDraft = {
  chapterTitle: string;
  sectionTitle: string;
  body: string;
  editorNotes: string[];
  followUpQuestions: string[];
  factCheckPoints: string[];
  continuityNotes: string[];
};
右カラム表示項目
本文
編集メモ
追加質問
事実確認ポイント
前後のつながりメモ
ボタン
この小見出しの本文を生成
本文を再生成
Wordで保存
全体Wordを出力
5.4 プロンプト保存画面

URL：

/prompts
目的

AIへの指示テンプレートを保存・編集する。

この画面を作ることで、単なるチャットAIではなく、編集業務用のAIシステムに見せる。

保存するプロンプト

最低限、以下の5種類を用意する。

type PromptTemplate = {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  userPromptTemplate: string;
  outputFormat: string;
};
初期プロンプト一覧
構成案生成プロンプト
小見出し生成プロンプト
本文生成プロンプト
編集者レビュー用プロンプト
追加質問生成プロンプト
画面項目
プロンプト一覧
プロンプト名
用途説明
システムプロンプト入力欄
ユーザープロンプトテンプレート入力欄
出力フォーマット入力欄
保存ボタン
初期値に戻すボタン
初期プロンプト例：構成案生成
あなたは自費出版会社に所属する経験豊富な編集者です。
取材メモをもとに、書籍化または長文記事化するための章立て構成案を3種類作成してください。

必ず以下の3方向で提案してください。

1. 時系列型
2. テーマ型
3. 人物伝・読み物型

各案には以下を含めてください。

- 構成案タイトル
- コンセプト
- おすすめ用途
- 章タイトル
- 各章の概要

過度な脚色は避け、取材メモに含まれる事実を中心に構成してください。
事実が不足している場合は、推測で断定せず、不足情報として扱ってください。
初期プロンプト例：本文生成
あなたは自費出版会社の編集者兼ゴーストライターです。
以下の基本情報、取材メモ、年表、選択済み章立て、文体ルールを必ず守って、指定された小見出しの本文を書いてください。

目的は、著者本人の人生や想いを、誠実で読みやすい文章として整えることです。

守るべきルール：
- 取材メモにない事実を断定しない
- 美談化しすぎない
- 本人の言葉を尊重する
- 章全体の流れと矛盾しない
- 前後の章と自然につながるようにする
- 文体は落ち着いた人物伝風
- 編集者が後で直しやすいように、過度に凝った表現は避ける

出力には以下を含めてください。

1. 本文
2. 編集メモ
3. 追加質問
4. 事実確認ポイント
5. 前後のつながりメモ
5.5 基本情報・執筆メモリ画面

URL：

/memory
目的

長い本を書いている途中でAIが基本情報を忘れないように、プロジェクトの核となる情報を保存する。

保存項目
type WritingMemory = {
  profile: {
    name: string;
    age: string;
    occupation: string;
    location: string;
    personality: string[];
    keyPhrases: string[];
  };
  bookConcept: {
    mainTheme: string;
    targetReader: string;
    tone: string;
    avoidExpressions: string[];
  };
  timeline: {
    period: string;
    event: string;
    notes: string;
  }[];
  confirmedFacts: string[];
  uncertainFacts: string[];
  styleRules: string[];
  selectedOutlineSummary: string;
  chapterSummaries: {
    chapterTitle: string;
    summary: string;
  }[];
};
画面項目
人物プロフィール
年表
本全体のテーマ
想定読者
文体ルール
避けたい表現
重要な発言
確定済み事実
未確認情報
各章の要約
重要

本文生成時には、この WritingMemory を必ずAIに渡す。

5.6 Word出力機能
目的

生成した原稿をWord形式で保存できるようにする。

出力対象

最低限、以下の2種類を出力できるようにする。

1. 選択中の小見出し本文.docx
2. 全体原稿ドラフト.docx

可能であれば以下も追加する。

3. 編集メモ付き.docx
4. 追加質問リスト.docx
Word構成
タイトル
リード文
章タイトル
小見出し
本文

編集メモ
追加質問
事実確認ポイント
前後のつながりメモ
ファイル名例
聞き書き出版AI_全体原稿ドラフト.docx
第1章_東京での修業時代.docx
6. データ構造
Project型
export type Project = {
  id: string;
  name: string;
  intervieweeName: string;
  theme: string;
  targetReader: string;
  desiredTone: string;
  interviewNotes: string;
  outlineProposals: OutlineProposal[];
  selectedOutline?: OutlineProposal;
  writingMemory: WritingMemory;
  generatedSections: SectionDraft[];
  createdAt: string;
  updatedAt: string;
};
OutlineProposal型
export type OutlineProposal = {
  id: string;
  title: string;
  type: "chronological" | "thematic" | "narrative";
  concept: string;
  recommendedFor: string;
  chapters: Chapter[];
};
Chapter型
export type Chapter = {
  id: string;
  chapterNumber: number;
  title: string;
  summary: string;
  sections: Section[];
};
Section型
export type Section = {
  id: string;
  title: string;
  summary?: string;
};
SectionDraft型
export type SectionDraft = {
  id: string;
  chapterId: string;
  sectionId: string;
  chapterTitle: string;
  sectionTitle: string;
  body: string;
  editorNotes: string[];
  followUpQuestions: string[];
  factCheckPoints: string[];
  continuityNotes: string[];
  createdAt: string;
  updatedAt: string;
};
7. API設計
7.1 構成案生成API

Endpoint：

POST /api/generate-outline

Request：

{
  projectName: string;
  intervieweeName: string;
  theme: string;
  targetReader: string;
  desiredTone: string;
  interviewNotes: string;
  promptTemplate: PromptTemplate;
}

Response：

{
  proposals: OutlineProposal[];
}
7.2 小見出し生成API

Endpoint：

POST /api/generate-sections

Request：

{
  selectedOutline: OutlineProposal;
  interviewNotes: string;
  writingMemory: WritingMemory;
}

Response：

{
  outline: OutlineProposal;
}

各章に sections を追加して返す。

7.3 本文生成API

Endpoint：

POST /api/generate-draft

Request：

{
  project: Project;
  chapter: Chapter;
  section: Section;
  promptTemplate: PromptTemplate;
}

Response：

{
  draft: SectionDraft;
}
7.4 編集レビューAPI

Endpoint：

POST /api/review-draft

Request：

{
  draft: SectionDraft;
  writingMemory: WritingMemory;
  promptTemplate: PromptTemplate;
}

Response：

{
  editorNotes: string[];
  followUpQuestions: string[];
  factCheckPoints: string[];
  revisionSuggestions: string[];
}
8. AI出力形式

AIの出力は、可能な限りJSONで返す。

構成案生成のJSON例
{
  "proposals": [
    {
      "id": "outline-a",
      "title": "時系列型構成",
      "type": "chronological",
      "concept": "人生の流れに沿って、読者が自然に人物の歩みを追える構成。",
      "recommendedFor": "自分史、家族向け出版、人生記録。",
      "chapters": [
        {
          "id": "chapter-1",
          "chapterNumber": 1,
          "title": "東京での修業時代",
          "summary": "若き日に東京で働いていた時期を描く。",
          "sections": []
        }
      ]
    }
  ]
}
本文生成のJSON例
{
  "draft": {
    "id": "draft-001",
    "chapterId": "chapter-1",
    "sectionId": "section-1",
    "chapterTitle": "東京での修業時代",
    "sectionTitle": "東京で見た夢",
    "body": "本文がここに入ります。",
    "editorNotes": [
      "この部分では、東京時代の具体的な仕事内容が不足しています。"
    ],
    "followUpQuestions": [
      "東京ではどのような仕事をしていましたか？",
      "当時、将来についてどのように考えていましたか？"
    ],
    "factCheckPoints": [
      "東京で働いていた会社名",
      "勤務していた時期"
    ],
    "continuityNotes": [
      "次の章では、父の病気をきっかけに帰郷する流れへ接続すると自然です。"
    ]
  }
}
9. UIデザイン方針
トーン
業務アプリ風
編集者が使う管理画面風
白背景
落ち着いたグレー・ネイビー系
派手なAI感は不要
信頼感、実務感を優先
推奨レイアウト
上部：アプリ名 / ナビゲーション

左：入力・章立て・小見出し
右：AI出力

下部：保存ボタン / Word出力ボタン
ナビゲーション
取材メモ
構成案
原稿生成
基本情報・執筆メモリ
プロンプト管理
10. 初期サンプルデータ

デモ時にすぐ見せられるように、サンプル取材メモを入れておく。

export const sampleInterviewNotes = `
対象者：70代男性。
地方で小さな印刷会社を経営していた。
若い頃は東京で働いていたが、父の病気をきっかけに帰郷。
家業の印刷会社を継ぐことになった。
当初は自分が継ぐつもりはなかった。
バブル崩壊後、仕事が激減し、借金も抱えた。
大手の仕事は減っていったが、地域の商店街のチラシ制作を続けた。
地元の店主たちとの信頼関係を大切にしてきた。
本人は「派手な成功ではないが、逃げなかったことだけは誇れる」と話している。
家族には苦労をかけたという思いもある。
いま振り返ると、会社を大きくすることよりも、地域に必要とされ続けることが大切だったと感じている。
`;
11. 実装優先順位

今日のデモで必須なのは以下。

必須
取材メモ入力
構成案3案生成
構成案選択
章・小見出し表示
小見出し本文生成
localStorage保存
Word出力
プロンプト管理画面
基本情報・執筆メモリ画面
余裕があれば
生成中ローディング表示
再生成ボタン
文体変更ボタン
編集レビュー機能
追加質問だけを一覧化
章ごとのWord出力
全体Word出力
Markdownプレビュー
12. エラーハンドリング

最低限、以下を実装する。

APIキー未設定時のエラー表示
取材メモが空の場合のバリデーション
AI API失敗時のエラー表示
JSON parse失敗時のフォールバック表示
Word出力対象が空の場合のエラー表示

表示例：

AI生成に失敗しました。APIキーまたは入力内容を確認してください。
取材メモを入力してください。
13. AIプロンプトに必ず含めるルール

AI生成時には、以下のルールを毎回含める。

- 取材メモにない事実を断定しない
- 不明点は追加質問または事実確認ポイントに回す
- 著者本人を過度に美化しない
- 自費出版の本文として自然な語り口にする
- 編集者が後から修正しやすい文章にする
- 章全体の流れと矛盾しない
- 重要な発言はできるだけ活かす
- 読者が人物像を理解できるように書く
14. 完成イメージ

ユーザー操作の流れ：

取材メモを貼る
↓
章立て案を生成
↓
3案から選ぶ
↓
選んだ構成の章・小見出しが表示される
↓
小見出しをクリック
↓
本文・編集メモ・追加質問が生成される
↓
Wordで保存

社長への説明文：

このデモは、取材メモからいきなり本を完成させるものではありません。
まず複数の章立てを提示し、編集者が方向性を選びます。
その後、各章・各小見出し単位で本文を生成し、編集者が確認・修正しながら本全体を組み上げていきます。
長文制作でAIが基本情報を忘れないように、人物情報・年表・文体ルール・確定済み章立てをプロジェクトメモリとして保持します。
生成した原稿はWord形式で出力できるため、既存の編集・校正フローにも接続できます。
15. Claudeへの実装指示

以下の方針で実装してください。

Next.js + TypeScriptで、上記仕様のデモアプリを作成してください。

本番DBは不要です。
localStorageでプロジェクト情報、プロンプト、生成済み本文を保存してください。

AI APIはOpenAIまたはAnthropic Claudeのどちらかを使える構成にしてください。
環境変数で切り替えられるようにしてください。

UIは業務アプリ風にしてください。
派手な演出より、編集者が実務で使えそうに見えることを優先してください。

Word出力はdocxライブラリを使って実装してください。

まずは以下の画面を作ってください。

1. 取材メモ入力画面
2. 章立て構成案画面
3. 原稿生成画面
4. プロンプト管理画面
5. 基本情報・執筆メモリ画面

各画面はナビゲーションで移動できるようにしてください。

API Routeは以下を作ってください。

- /api/generate-outline
- /api/generate-sections
- /api/generate-draft
- /api/review-draft

AI出力はJSONを基本にしてください。
JSON parseに失敗した場合も画面が壊れないようにしてください。

サンプル取材メモを初期値として入れてください。