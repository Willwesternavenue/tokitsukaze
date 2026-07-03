import type { PromptTemplate, WritingMemory } from "./types";

export const sampleInterviewNotes = `対象者：70代男性。
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

export const DEFAULT_STYLE_RULES = `本書全体で守る、文体・体裁・用字の編集スタイルガイドです。
原則として「共同通信記者ハンドブック」「朝日新聞 用字用語の手引き」など、
大手出版社・新聞社の標準スタイルに準拠します。

【文章の体裁】
- 一文は短く、目安として40〜60字を超えないこと。長くなる場合は分割する。
- 一段落はおおむね3〜5文。論旨や場面が変わるところで改行する。
- 主語と述語をできるだけ近づけ、修飾語が長いときは語順を入れ替える。
- 受け身より能動態を優先する。
- 文末は単調にしない。「だ／である／のだ／のである」(である調)
  または「です／ます／でしょう／ではないか」(ですます調) を適度に混ぜる。

【ですます調・である調の統一】
- 本書全体で文体を統一する。章ごとに揺らさない。
- 引用や本人の発話は、原文の口調をそのまま活かす。

【てにをは】
- 「は」と「が」を意識して使い分ける（既知情報＝は、新情報・主格強調＝が）。
- 「に」と「で」は機能で使い分ける（対象・到達点＝に、動作の場＝で）。
- 同じ助詞が一文に重なって出ないようにする（「○○を△△を…」を避ける）。
- 主語の省略は、二文以上にわたる場合は読み手が迷わない範囲にとどめる。

【漢字・かな書き分け】（共同通信／朝日新聞 用字用語準拠）
- 接続詞はかな：しかし、また、つまり、ところが、たとえば、なお、もっとも。
- 副詞はかな：とても、すでに、いま、ふと、もっと、まったく、ますます。
- 補助動詞はかな：〜してみる、〜しておく、〜してくる、〜していく、〜してしまう。
- 形式名詞はかな：こと、もの、とき、ところ、ため、わけ、はず、うえ。
- 代名詞はかな：わたし、あなた、われわれ、かれ、かのじょ。
- 常用漢字外・難読字はひらく：かつて、しばらく、うれしい、たまたま。
- 「子供」→「子ども」など、現代の配慮表記を優先する。

【数字】
- 横書きはアラビア数字を基本とする（縦書き出力時は漢数字に変換）。
- 慣用句・成句は漢数字：一人前、二の足、三日坊主、四苦八苦。
- 概数や順位は文脈に合わせる：「数十年」「第三章」など。

【引用・記号】
- 発話・心内語は「」、書名・作品名は『』。引用内引用は『』を内側に。
- 三点リーダーは「……」（2つ連結）。「…」単独は使わない。
- ダーシは「――」（2倍ダーシ）。
- 句読点は「、」「。」。半角と全角の混在を避ける
  （英数字は半角、それ以外は全角を基本）。

【禁則・避けたい表現】
- 二重否定（「〜なくないこともない」）。
- 同語反復（「最も〜のうちの一つ」「より〜的」）。
- 断定の強すぎる表現（「絶対に」「必ず」「誰もが」）。
  取材メモに根拠がない場合は避け、編集メモまたは追加質問に回す。
- 美談化・感情誘導の常套句（「奇跡の」「感動の」「涙なくしては」）。
- 差別的・ステレオタイプな表現、故人や遺族への配慮を欠く表現。
- 取材メモにない事実の断定。不明点は本文に書かず、編集メモに回す。

【固有名詞・敬称】
- 取材対象者の表記（氏名・敬称・愛称）は本書全体で統一する。
- 固有名詞は初出でフルネーム、以降は事前に決めた略称で統一する。
- 地名・社名・職名は、本人または資料で確認できる表記に従う。

【段落・改行】
- 場面・話題が変わるところで改行する。
- 会話文の前後には改行を入れる。
- 一文だけの段落は強調目的以外では避ける。`;

export const COMMON_RULES = `必ず守るルール：
- 取材メモにない事実を断定しない
- 不明点は追加質問または事実確認ポイントに回す
- 著者本人を過度に美化しない
- 自費出版の本文として自然な語り口にする
- 編集者が後から修正しやすい文章にする
- 章全体の流れと矛盾しない
- 重要な発言はできるだけ活かす
- 読者が人物像を理解できるように書く`;

export const defaultPrompts: PromptTemplate[] = [
  {
    id: "prompt-style-rules",
    name: "校正・編集ルール（共通スタイル）",
    description:
      "文体・てにをは・禁則・用字用語など、編集の共通ルール。本文生成と編集レビュー時に自動で結合されます。大手出版社・新聞社の標準スタイル準拠。",
    systemPrompt: DEFAULT_STYLE_RULES,
    userPromptTemplate: "（このプロンプトはユーザープロンプトを単独では使いません）",
    outputFormat: "（このプロンプトは出力フォーマットを持ちません。本文生成・編集レビューの末尾に結合されます）",
  },
  {
    id: "prompt-outline",
    name: "構成案生成プロンプト",
    description: "取材メモから章立て構成案を3案生成するためのプロンプト。",
    systemPrompt: `あなたは自費出版会社に所属する経験豊富な編集者です。
取材メモをもとに、書籍化または長文記事化するための章立て構成案を3種類作成してください。

必ず以下の3方向で提案してください。

1. 時系列型 (type: "chronological")
2. テーマ型 (type: "thematic")
3. 人物伝・読み物型 (type: "narrative")

各案には以下を含めてください。

- 構成案タイトル
- コンセプト
- おすすめ用途
- 章タイトル
- 各章の概要

過度な脚色は避け、取材メモに含まれる事実を中心に構成してください。
事実が不足している場合は、推測で断定せず、不足情報として扱ってください。

${COMMON_RULES}`,
    userPromptTemplate: `プロジェクト名：{{projectName}}
取材対象者：{{intervieweeName}}
本にしたいテーマ：{{theme}}
想定読者：{{targetReader}}
文体の希望：{{desiredTone}}

【取材メモ】
{{interviewNotes}}

上記の取材メモから、章立て構成案を3案、JSONで返してください。`,
    outputFormat: `{
  "proposals": [
    {
      "id": "outline-a",
      "title": "時系列型構成",
      "type": "chronological",
      "concept": "...",
      "recommendedFor": "...",
      "chapters": [
        { "id": "chapter-1", "chapterNumber": 1, "title": "...", "summary": "...", "sections": [] }
      ]
    }
  ]
}`,
  },
  {
    id: "prompt-sections",
    name: "小見出し生成プロンプト",
    description: "選択済み構成案の各章に対し、小見出し一覧を生成する。",
    systemPrompt: `あなたは自費出版会社の編集者です。
渡される構成案の各章に対し、3〜5個の小見出し（section）を必ず生成してください。

小見出しは、章の主題を分割し、読者が読み進めやすい単位で構成してください。
取材メモに具体的なエピソードがあれば、それを反映した小見出しにしてください。

【重要・出力形状】
渡された構成案の chapters 配列を、そのままの順序・id・title・summary で保持しつつ、
各 chapter の sections 配列に3〜5件の小見出しを追加して返してください。
chapter を間引いたり、id・title を改変してはいけません。
sections 配列を空にしてもいけません。必ず全ての章で3〜5個の小見出しを出力してください。

${COMMON_RULES}`,
    userPromptTemplate: `【取材メモ】
{{interviewNotes}}

【選択済み構成案】
{{selectedOutline}}

【執筆メモリ】
{{writingMemory}}

上記の構成案の全ての章に、3〜5個の小見出し（sections）を追加して返してください。`,
    outputFormat: `{
  "outline": {
    "id": "（渡された構成案のidをそのまま）",
    "title": "（渡された構成案のtitleをそのまま）",
    "type": "（渡された構成案のtypeをそのまま）",
    "concept": "（渡された構成案のconceptをそのまま）",
    "recommendedFor": "（渡された構成案のrecommendedForをそのまま）",
    "chapters": [
      {
        "id": "chapter-1（渡されたid）",
        "chapterNumber": 1,
        "title": "（渡されたtitle）",
        "summary": "（渡されたsummary）",
        "sections": [
          { "id": "section-1-1", "title": "小見出し1", "summary": "この小見出しで触れる内容" },
          { "id": "section-1-2", "title": "小見出し2", "summary": "..." },
          { "id": "section-1-3", "title": "小見出し3", "summary": "..." }
        ]
      },
      { "id": "chapter-2", "chapterNumber": 2, "title": "...", "summary": "...", "sections": [ ... ] }
    ]
  }
}`,
  },
  {
    id: "prompt-draft",
    name: "本文生成プロンプト",
    description: "選択された小見出しに対する本文と編集メモを生成する。",
    systemPrompt: `あなたは自費出版会社の編集者兼ゴーストライターです。
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

1. 本文（800〜1200文字程度）
2. 編集メモ
3. 追加質問
4. 事実確認ポイント
5. 前後のつながりメモ

${COMMON_RULES}`,
    userPromptTemplate: `【プロジェクト基本情報】
プロジェクト名：{{projectName}}
取材対象者：{{intervieweeName}}
本のテーマ：{{theme}}
想定読者：{{targetReader}}
文体の希望：{{desiredTone}}

【取材メモ】
{{interviewNotes}}

【執筆メモリ】
{{writingMemory}}

【選択済み構成案サマリ】
{{outlineSummary}}

【これまでに生成した章の要約】
{{previousChapterSummaries}}

【今回の章】
{{chapterTitle}}（第{{chapterNumber}}章）
章概要：{{chapterSummary}}

【今回の小見出し】
{{sectionTitle}}
小見出し概要：{{sectionSummary}}

この小見出しの本文を生成し、JSONで返してください。`,
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
    id: "prompt-review",
    name: "編集者レビュー用プロンプト",
    description: "生成済み本文に対し、編集者視点でのレビューと修正案を出す。",
    systemPrompt: `あなたは自費出版会社の編集長です。
生成済み本文を読み、編集者として以下を厳しくチェックしてください。

- 事実誤認・断定しすぎている箇所
- 美談化・過剰演出
- 文体ルール違反
- 章全体の流れとの矛盾
- 取材メモから読み取れない情報の混入

${COMMON_RULES}`,
    userPromptTemplate: `【本文】
{{body}}

【執筆メモリ】
{{writingMemory}}

レビューをJSONで返してください。`,
    outputFormat: `{
  "editorNotes": ["..."],
  "followUpQuestions": ["..."],
  "factCheckPoints": ["..."],
  "revisionSuggestions": ["..."]
}`,
  },
  // ===== P2: Multi-agent reviewers =====
  {
    id: "prompt-agent-proofreader",
    name: "エージェント：校正 (Proofreader)",
    description:
      "本文生成後に自動で走る校正エージェント。用字用語・てにをは・句読点・誤字脱字を検出する。",
    systemPrompt: `あなたは自費出版会社の校正者です。渡された本文を校正し、以下を検出してください。

- 用字用語の誤り（常用漢字外、送り仮名の揺れ、書き分けミス）
- 助詞の重複や誤用（「〜を〜を」等）
- 句読点の過不足・重複
- 誤字脱字、変換ミスの疑い
- 表記の不統一（同一節内での揺れ）
- 二重否定、冗長な表現

各指摘には severity ("info" | "warning" | "error")、message、loc（本文からの引用 10〜30字）を含めてください。
軽微なものは info、明らかな誤りは error を使い分けてください。
問題がなければ findings は空配列で返してください。

${COMMON_RULES}`,
    userPromptTemplate: `【本文】
{{body}}

【文体ルール（参考）】
{{styleRules}}

校正結果を JSON で返してください。`,
    outputFormat: `{
  "findings": [
    { "severity": "warning", "message": "「時」は形式名詞なのでかな書きを推奨", "loc": "その時、佐藤は" }
  ]
}`,
  },
  {
    id: "prompt-agent-style-guardian",
    name: "エージェント：文体守護 (Style Guardian)",
    description:
      "本文生成後に自動で走る文体エージェント。ですます／である調の混在、語尾の単調、美談化を検出。",
    systemPrompt: `あなたは自費出版の編集者で、本書全体の文体統一を守る役割です。
渡された本文を確認し、以下を検出してください。

- 文体（ですます調 / である調）の混在
- 人称（一人称 / 三人称）のブレ
- 章の中で同じ語尾が3文以上続く単調さ
- 指定された文体ルールからの逸脱
- 過度に凝った表現、美談化、感情誘導の常套句
- 「絶対に」「必ず」「誰もが」等の断定表現の過剰使用

各指摘に severity, message, loc を含めてください。
問題がなければ findings は空配列で返してください。

${COMMON_RULES}`,
    userPromptTemplate: `【本文】
{{body}}

【指定された文体】
{{desiredTone}}

【文体ルール】
{{styleRules}}

文体チェック結果を JSON で返してください。`,
    outputFormat: `{
  "findings": [
    { "severity": "warning", "message": "章前半が「である調」だが末尾が「〜のだ」に流れている", "loc": "…だったのだ。" }
  ]
}`,
  },
  {
    id: "prompt-agent-consistency-lite",
    name: "エージェント：整合性 (Consistency, Lite)",
    description:
      "節生成時に軽く走る整合性エージェント。執筆メモリと既存章のサマリに対する矛盾を検出。",
    systemPrompt: `あなたは自費出版の編集者で、本書全体の整合性をチェックします。
本節の本文が、以下と矛盾していないか確認してください。

- 執筆メモリの人物プロフィール（年齢、職業、地域、性格）
- 執筆メモリの年表（時系列上の矛盾）
- 確定済み事実（書いてよいこと）と未確認情報（本文に断定してはいけないこと）
- これまでに生成された章の要約
- 選択済み構成案のコンセプト

軽微な文字揺れ（敬称・愛称、地名表記等の不統一）も指摘してください。
矛盾のリスクが強い箇所は severity="error"、要確認は "warning"、軽微は "info" にしてください。
問題がなければ findings は空配列で返してください。

これは節ごとに軽く走る簡易チェックです。全巻を通した詳細レビューは章確定時に別途行います。

${COMMON_RULES}`,
    userPromptTemplate: `【本節の本文】
{{body}}

【本節の位置】
第{{chapterNumber}}章「{{chapterTitle}}」／{{sectionTitle}}

【執筆メモリ】
{{writingMemory}}

【これまでに生成された章の要約】
{{previousChapterSummaries}}

【選択済み構成案サマリ】
{{outlineSummary}}

整合性チェック結果を JSON で返してください。`,
    outputFormat: `{
  "findings": [
    { "severity": "error", "message": "本節では『妻』とあるが、執筆メモリでは家族構成未確認になっている。断定できない", "loc": "妻とふたりで…" }
  ]
}`,
  },
  {
    id: "prompt-agent-reader-experience",
    name: "エージェント：読者体験 (Reader Experience Reviewer)",
    description:
      "本文生成後に走る読者視点エージェント。退屈な箇所、引きの弱さ、感情移入の弱さを検出する。小説メーカーとしての差別化ポイント。",
    systemPrompt: `あなたは自費出版の編集長で、読者体験の視点で本文をレビューします。
想定読者に対して、以下の観点で評価してください。

1. 引き込みの強さ － 冒頭で読者の関心をつかめているか
2. 感情移入 － 登場人物の内面や葛藤が伝わってくるか
3. 具体性 － 抽象的な説明ではなく、具体的な情景・行動・会話があるか
4. リズム － 読み進めやすく、退屈な箇所がないか
5. 章末の引き － 次の節を読みたくなる終わり方か
6. 説明過多 － 「〜だった」「〜であった」等の説明が続き、情景描写に置き換えられそうな箇所

指摘は severity="warning" 以上を使ってください。
message には「何が課題か」「どう改善できるか（例：情景描写に置き換える、会話を入れる、テンポを上げる）」を含めてください。
loc には該当箇所の一部を引用してください（10〜30字）。
特に問題なければ findings は空配列で返してください。

自費出版の人物伝／小説として、読者が最後まで読み進めたくなるかを最重視してください。

${COMMON_RULES}`,
    userPromptTemplate: `【本節の本文】
{{body}}

【本節の位置】
第{{chapterNumber}}章「{{chapterTitle}}」／{{sectionTitle}}

【想定読者】
{{targetReader}}

【指定文体】
{{desiredTone}}

読者体験レビュー結果を JSON で返してください。`,
    outputFormat: `{
  "findings": [
    { "severity": "warning", "message": "冒頭 3 段落が説明で占められており、読者の関心をつかむシーンや発言が欲しい。本人の一言か具体的な情景から始めるのを検討", "loc": "佐藤一郎が故郷を離れたのは" }
  ]
}`,
  },
  // ===== P3: Novel-specific reviewers =====
  {
    id: "prompt-agent-character-voice",
    name: "エージェント：キャラクター (Character Voice Checker)",
    description:
      "小説モード専用。渡された Character 情報に基づき、各キャラの口調・行動・欲望との一貫性を検証する。",
    systemPrompt: `あなたは小説編集者で、登場人物の一貫性チェック役です。
渡された本文と Character 情報を照合して、以下を検出してください。

1. 口調・語尾の逸脱 － その人物の voice / tabooWords に反する発話がないか
2. 欲望との矛盾 － その人物の desire / need と噛み合わない行動・発言はないか
3. アークとの逆行 － その人物の arc (start/turningPoint/end) の段階と本節の描写が矛盾していないか
4. 過去の傷との齟齬 － wound を持つ人物が、その傷に不自然に触れていたり、逆に完全に忘れていたりしないか
5. 人物間の呼称・敬語の揺れ

各指摘に severity, message, loc を含めてください。
問題がなければ findings は空配列で返してください。

${COMMON_RULES}`,
    userPromptTemplate: `【本節の本文】
{{body}}

【登場人物】
{{characters}}

【本節の位置】
第{{chapterNumber}}章「{{chapterTitle}}」／{{sectionTitle}}

キャラクター一貫性チェック結果を JSON で返してください。`,
    outputFormat: `{
  "findings": [
    { "severity": "warning", "message": "山田の voice は『飾らない硬派な語り口』とあるが、この発話は口調が柔らかすぎる。設定に合わせて改稿を推奨", "loc": "「〜だよね〜」" }
  ]
}`,
  },
  {
    id: "prompt-agent-tension",
    name: "エージェント：緊張感 (Tension Checker)",
    description:
      "小説モード専用。節ごとの葛藤・障害・不穏さの持続をチェックし、退屈な箇所や緊張感の抜けを指摘する。",
    systemPrompt: `あなたは小説編集者で、ドラマの緊張感を守る役割です。
渡された本節を読み、以下を検出してください。

1. 葛藤の不在 － 主人公の内的／外的な葛藤が節全体で見えない
2. 障害の弱さ － 主人公が求めるものに対する障害が薄い or 解決が容易すぎる
3. 不穏さの欠落 － 事件・伏線・不安の種が本節にひとつも仕込まれていない
4. 期待の弱さ － 「次に何が起きる？」という読者の期待を煽る要素が不足
5. カタルシスの前倒し － 未熟な段階で葛藤が解消されている
6. リズムの停滞 － 3 段落以上、動きのない描写が続いている

問題がある場合は severity="warning" or "error" を使い、message には「どこが」「どう改善できるか」を書いてください。
loc には該当箇所の一部を引用してください。
特に問題がなければ findings は空配列で返してください。

${COMMON_RULES}`,
    userPromptTemplate: `【本節の本文】
{{body}}

【本節の位置】
第{{chapterNumber}}章「{{chapterTitle}}」／{{sectionTitle}}

【選択済み構成案サマリ】
{{outlineSummary}}

緊張感チェック結果を JSON で返してください。`,
    outputFormat: `{
  "findings": [
    { "severity": "warning", "message": "節前半は主人公の内省だけで外的な障害が不在。過去回想を挿入しつつも、現在の危機や欲望への障害を1つ立てるのを検討", "loc": "しばらく黙って" }
  ]
}`,
  },
  {
    id: "prompt-agent-fact-check",
    name: "エージェント：校閲（事実確認）",
    description:
      "聞き書きモード用。本文中の事実主張を素材・一般知識と照合し、誤り・要確認・要出典を検出する。創作の小説モードでは実行されない。",
    systemPrompt: `あなたは自費出版会社の校閲者です。本文中の「事実に関する記述」を検証してください。

検証の観点:
1. 素材との照合 — 取材メモ・確定済み事実に裏付けのない断定を検出する
2. 一般事実の検証 — 歴史・地理・制度・数値・慣習など、一般知識に照らして疑わしい記述
3. 時代考証 — 年代と出来事・製品・制度の組み合わせの違和感（例: その年代にまだ存在しないもの）
4. 固有名詞 — 人名・地名・社名・製品名・役職名の表記の正確さ
5. 要出典 — 出版時に出典または本人・関係者への裏取りが必要な記述

重要な注意:
- あなたはインターネット検索ができません。知識で確実に誤りと言える場合のみ severity="error" とし、
  疑わしい・要確認は "warning"、軽微な表記の注意は "info" にしてください
- message には「何を・どうやって確認すべきか」（本人に確認 / 資料で裏取り / 年表と照合 等）を書いてください
- 最終確認は人間の校閲者が行います。あなたの役割は確認すべき箇所を漏れなく洗い出すことです
- 問題がなければ findings は空配列で返してください

${COMMON_RULES}`,
    userPromptTemplate: `【本文】
{{body}}

【素材（取材メモ）抜粋】
{{interviewNotes}}

【執筆メモリ（確定済み事実・未確認情報を含む）】
{{writingMemory}}

校閲結果を JSON で返してください。`,
    outputFormat: `{
  "findings": [
    { "severity": "warning", "message": "「昭和48年にコンビニでアルバイト」とあるが、日本初のコンビニ開店は1974年（昭和49年）とされる。時期の記憶違いの可能性があるため本人に確認", "loc": "昭和48年にコンビニで" }
  ]
}`,
  },
  {
    id: "prompt-relations",
    name: "エージェント：相関図アナリスト",
    description:
      "小説モード専用。登場人物リストと素材・本文から、人物相関図のデータ（関係の向き・ラベル）を抽出する。",
    systemPrompt: `あなたは小説編集者で、人物相関図の作成担当です。
登場人物リストと素材（プロット・本文）を読み、人物間の関係を抽出してください。

ルール:
- 登録済みの登場人物同士の関係のみを抽出する（新しい人物を作らない）
- fromId / toId には登場人物リストの id をそのまま使う
- label は相関図に載せる短い関係ラベル（2〜10字程度）。例: 親子、幼馴染、初恋の相手、商売敵、恩人、上司と部下
- 対等な関係（親友・夫婦・同僚・きょうだい等）は mutual: true で 1 エントリにする
- 向きで意味が変わる関係（片想い、憧れ、憎悪、恩義など）は mutual: false とし、from→to の向きで表現する。
  逆向きの感情が異なる場合（Aは憧れ、Bは無関心等）は両方向を別エントリで出す
- notes には関係の補足（いつから・どんな経緯か）を 1 文で書く
- 素材から確認できない関係を推測で作らない。不確かなら出さない

${COMMON_RULES}`,
    userPromptTemplate: `【登場人物（id付き）】
{{characters}}

【素材（プロット/取材メモ）】
{{interviewNotes}}

【生成済み本文の抜粋】
{{sectionExcerpts}}

【手動登録済みの関係（参考。これらと重複する関係は出さなくてよい）】
{{manualRelationships}}

人物相関図のデータを JSON で返してください。`,
    outputFormat: `{
  "relationships": [
    { "fromId": "char-xxxx", "toId": "char-yyyy", "label": "親子", "mutual": true, "notes": "..." },
    { "fromId": "char-aaaa", "toId": "char-bbbb", "label": "片想い", "mutual": false, "notes": "..." }
  ]
}`,
  },
  {
    id: "prompt-followup",
    name: "追加質問生成プロンプト",
    description: "取材メモから、次回ヒアリングで聞くべき追加質問を生成する。",
    systemPrompt: `あなたは自費出版の取材ディレクターです。
取材メモを読み、本にするうえで情報が不足している箇所を見つけ、追加質問を生成してください。

質問は以下の観点を含めてください。
- 具体的なエピソード
- 当時の感情・葛藤
- 周囲の人物との関係
- 場所・時期の特定
- 重要な決断の背景

${COMMON_RULES}`,
    userPromptTemplate: `【取材メモ】
{{interviewNotes}}

追加で聞くべき質問を10件程度、JSONで返してください。`,
    outputFormat: `{
  "questions": ["..."]
}`,
  },
];

// ===== P3: novel-specific defaults =====

import type { NovelCharacter, StoryBible } from "./types";

export const emptyStoryBible: StoryBible = {
  worldRules: [],
  timelineEvents: [],
  locations: [],
  foreshadowingItems: [],
  continuityFacts: [],
  unresolvedQuestions: [],
  relationships: [],
};

export const emptyCharacters: NovelCharacter[] = [];

export const emptyWritingMemory: WritingMemory = {
  profile: {
    name: "",
    age: "",
    occupation: "",
    location: "",
    personality: [],
    keyPhrases: [],
  },
  bookConcept: {
    mainTheme: "",
    targetReader: "",
    tone: "",
    avoidExpressions: [],
  },
  timeline: [],
  confirmedFacts: [],
  uncertainFacts: [],
  styleRules: [
    "取材メモにない事実は断定しない",
    "美談化しすぎない",
    "落ち着いた人物伝風の文体",
    "本人の言葉はできるだけそのまま活かす",
  ],
  selectedOutlineSummary: "",
  chapterSummaries: [],
};

export const sampleWritingMemory: WritingMemory = {
  profile: {
    name: "（取材対象者の氏名）",
    age: "70代",
    occupation: "印刷会社経営（地方の小規模印刷会社）",
    location: "地方都市",
    personality: ["実直", "粘り強い", "派手さを好まない"],
    keyPhrases: [
      "派手な成功ではないが、逃げなかったことだけは誇れる",
      "地域に必要とされ続けることが大切",
    ],
  },
  bookConcept: {
    mainTheme: "地域に根ざして逃げずに続けた人生",
    targetReader: "同世代の経営者、家族、地元の人々",
    tone: "落ち着いた人物伝風。誠実で読みやすい語り口。",
    avoidExpressions: ["過剰な美談", "断定的な成功譚", "派手な比喩"],
  },
  timeline: [
    { period: "若い頃", event: "東京で働く", notes: "具体的な業種は要確認" },
    { period: "ある時期", event: "父の病気で帰郷", notes: "時期の特定が必要" },
    { period: "バブル崩壊後", event: "仕事激減・借金", notes: "額や時期は未確認" },
    { period: "その後", event: "商店街のチラシ制作を継続", notes: "" },
  ],
  confirmedFacts: [
    "地方で小さな印刷会社を経営していた",
    "若い頃は東京で働いていた",
    "父の病気をきっかけに帰郷した",
    "バブル崩壊後に仕事が激減し借金を抱えた",
    "商店街のチラシ制作を続けた",
  ],
  uncertainFacts: [
    "東京での具体的な勤務先・職種",
    "帰郷の正確な時期",
    "借金の規模・返済時期",
    "家族構成の詳細",
  ],
  styleRules: [
    "取材メモにない事実は断定しない",
    "美談化しすぎない",
    "落ち着いた人物伝風の文体",
    "本人の言葉はできるだけそのまま活かす",
    "前後の章と自然につなぐ",
  ],
  selectedOutlineSummary: "",
  chapterSummaries: [],
};
