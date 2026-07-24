# PR-B4: 既存本文への引用差し込み（retrofit citation annotation） — 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 行番号ではなく本文中の文字列をアンカーに置換すること。

**Goal:** 論文モードで、すでに書かれた節本文を書き換えずに、AIが返す「差し込み位置＋文献ID」をもとにアプリが引用マーカー `〔著者, 年〕` を機械挿入する。1件ずつ採否・地の文は不変。

**Architecture:** 純粋ロジック `citationAnnotate.ts`（`planAnnotations`/`applyAnnotations`）が安全性の核＝厳密一致・元本文オフセット・句点基準のマーカー位置・決定論dedup・再実行安全を保証。AI呼び出しは `extract-reference-card` 型の同期await route ＋ `referenceCard` 型ワークフロー。保存は `replaceDraftBody` 相当の常時1版退避＋PR-A自動ロック。UIは節の本文エリアのボタン＋レビュー一覧。

**Tech Stack:** Next.js 14 / TypeScript / Vercel Workflow（`"use workflow"`/`"use step"`）/ `runAiStep`（`src/workflows/shared.ts`）/ localStorage 永続。

## Global Constraints

- **テストランナーは無い**。検証は純粋ロジックを scratchpad の node スクリプト（実装コードを移植して assert）、`npx tsc --noEmit`、`npx next build`、ブラウザ実機（このリポジトリの既定運用）。
- **tsc/build は Node 24**: 各コマンド前に `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24.15.0 >/dev/null`。build 成功＝`✓ Generating static pages`（`unpdf`・`next.config` の既存 warning は無視）。
- **コミット**: `git -c user.name="Will" -c user.email="tachiiri@westernavenu.com" commit`、本文末尾 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。
- **スコープは論文のみ**（`genre==="paper"` かつ本文生成済みかつ `references.length>0` でのみ発火）。挿入は正準マーカー `authorYearMarker(ref)` のみ（体裁変換・脚注化・参考文献リストは既存Word出力/PR-B3が担当・無改修）。
- **安全性の核（設計 ③④）**: 照合は**厳密一致のみ**（正規化しない）。`index` は常に**元本文のオフセット**。マーカー位置はアプリが**句点基準**で確定（`quoteEnd` から行内最初の `。｜！｜？` の直前／無ければ行末・本文末）。同一 `(insertAt, refId)` は**dedup**、同一 `insertAt` の複数 refId は **proposal 配列順**。既に `〔…〕` がある文への提案は **already-cited でスキップ**（再実行安全）。`authorYearMarker` は著者欠損時 `title` にフォールバックし空マーカーは出ない。
- **保存**: retrofit は必ず復元点を作る＝`replaceDraftBody` 相当で常時1版 `bodyHistory` に退避（圧縮しない）＋論文で未ロックなら自動ロック（`lockReason="manual"`）。
- 参照本体は `project.references`（`Reference = { id, title, author?, source?, year?, url?, notes?, card? }`）。
- **文字列アンカー必須**。行番号は参考値。

---

## Task 1: 純粋ロジック `src/lib/citationAnnotate.ts`（安全性の核）

**Files:**
- Create: `src/lib/citationAnnotate.ts`

**Interfaces:**
- Consumes: `Reference`（`./types`）、`authorYearMarker`（`./citation`・既存）。
- Produces: 型 `CitationProposal`/`AnnotationItem`/`SkippedItem`/`AnnotationPlan`、関数 `planAnnotations(body, proposals, refs)`、`applyAnnotations(body, chosen)`（Task 2/4 が consume）。

- [ ] **Step 0: 裏取り**

Run:
- `grep -n 'export function authorYearMarker' src/lib/citation.ts` → 1件（存在）。
- `sed -n '/export type Reference = {/,/^}/p' src/lib/types.ts` → `id`/`title`/`author?`/`source?`/`year?`/`url?`/`notes?`/`card?`（想定どおり）。

- [ ] **Step 1: 純粋ロジックの scratchpad サニティ（実装と同じロジックを移植）**

scratchpad に `pr-b4-plan.mjs` を作成（`authorYearMarker` も移植・下の Step 2 と同一ロジック）:

```js
function shortAuthor(r){const a=(r.author??"").trim();if(a){const f=a.split(/[,、;；・&]| and /)[0].trim();return f||a;}return r.title.trim();}
function authorYearMarker(r){const a=shortAuthor(r);const y=(r.year??"").trim();return y?`〔${a}, ${y}〕`:`〔${a}〕`;}
const SENTENCE_END=/[。！？]/;
function markerPosition(body,quoteEnd){for(let i=quoteEnd;i<body.length;i++){const c=body[i];if(c==="\n")return i;if(SENTENCE_END.test(c))return i;}return body.length;}
function sentenceAlreadyCited(body,insertAt){let s=0;for(let i=insertAt-1;i>=0;i--){const c=body[i];if(c==="\n"||SENTENCE_END.test(c)){s=i+1;break;}}let e=body.length;for(let i=insertAt;i<body.length;i++){const c=body[i];if(c==="\n"||SENTENCE_END.test(c)){e=i;break;}}return /〔[^〕]*〕/.test(body.slice(s,e));}
function planAnnotations(body,proposals,refs){const byId=new Map(refs.map(r=>[r.id,r]));const applied=[],needsManual=[],seen=new Set();
  proposals.forEach(proposal=>{const ref=byId.get(proposal.refId);if(!ref){needsManual.push({proposal,why:"unknown-ref"});return;}
    const first=body.indexOf(proposal.quote);if(first===-1){needsManual.push({proposal,ref,why:"no-match"});return;}
    if(body.indexOf(proposal.quote,first+1)!==-1){needsManual.push({proposal,ref,why:"ambiguous"});return;}
    const insertAt=markerPosition(body,first+proposal.quote.length);
    if(sentenceAlreadyCited(body,insertAt)){needsManual.push({proposal,ref,why:"already-cited"});return;}
    const key=`${insertAt}::${ref.id}`;if(seen.has(key))return;seen.add(key);
    applied.push({proposal,ref,insertAt,marker:authorYearMarker(ref)});});
  return {applied,needsManual};}
function applyAnnotations(body,chosen){const order=new Map(chosen.map((c,i)=>[c,i]));
  const sorted=[...chosen].sort((a,b)=>b.insertAt-a.insertAt||(order.get(b)-order.get(a)));
  let out=body;for(const it of sorted){out=out.slice(0,it.insertAt)+it.marker+out.slice(it.insertAt);}return out;}

const refs=[{id:"r1",title:"Attention",author:"Vaswani",year:"2017"},{id:"r2",title:"BERT",author:"Devlin",year:"2019"}];
const body="序論。RAGは検索と生成を組み合わせる手法である。先行研究では多くの試みが報告されている。";
// 1) 一意ヒット→applied、句点直前に位置
const p1=planAnnotations(body,[{quote:"検索と生成を組み合わせる手法である",refId:"r1",reason:"x"}],refs);
console.log("applied1:",p1.applied.length,"insertAtChar:",JSON.stringify(body[p1.applied[0].insertAt]));
console.log("apply1:",applyAnnotations(body,p1.applied));
// 2) 未一致(全角半角揺れ)→no-match
const p2=planAnnotations(body,[{quote:"RAGは検索と生成を組み合わせる手法である",refId:"r1",reason:"x"}].map(x=>({...x,quote:x.quote.replace("RAG","ＲＡＧ")})),refs);
console.log("no-match2:",p2.needsManual.map(n=>n.why));
// 3) 未登録refId→unknown-ref
console.log("unknown3:",planAnnotations(body,[{quote:"序論",refId:"rX",reason:"x"}],refs).needsManual.map(n=>n.why));
// 4) 複数採用の右→左 splice（同一文に2文献・proposal順）
const same="この主張は複数の根拠に支えられている。";
const p4=planAnnotations(same,[{quote:"この主張は複数の根拠に支えられている",refId:"r1",reason:"a"},{quote:"この主張は複数の根拠に支えられている",refId:"r2",reason:"b"}],refs);
console.log("apply4:",applyAnnotations(same,p4.applied));
// 5) already-cited（既にマーカーがある文はスキップ）＝再実行安全
const cited="RAGは検索と生成を組み合わせる手法である〔Vaswani, 2017〕。";
console.log("already5:",planAnnotations(cited,[{quote:"検索と生成を組み合わせる手法である",refId:"r1",reason:"x"}],refs).needsManual.map(n=>n.why));
// 6) 採用0件→本文不変
console.log("empty6-unchanged:",applyAnnotations(body,[])===body);
```

- [ ] **Step 2: サニティ実行**

Run: `node /tmp/pr-b4-plan.mjs`（scratchpad の絶対パスで。上を `/tmp/pr-b4-plan.mjs` に置いて実行）
Expected:
```
applied1: 1 insertAtChar: "。"
apply1: 序論。RAGは検索と生成を組み合わせる手法である〔Vaswani, 2017〕。先行研究では多くの試みが報告されている。
no-match2: [ 'no-match' ]
unknown3: [ 'unknown-ref' ]
apply4: この主張は複数の根拠に支えられている〔Vaswani, 2017〕〔Devlin, 2019〕。
already5: [ 'already-cited' ]
empty6-unchanged: true
```
（マーカーが句点の直前、複数文献は proposal 順、揺れ/未登録/既引用が正しく弾かれ、地の文が不変であること。）

- [ ] **Step 3: `src/lib/citationAnnotate.ts` を作成**

```ts
import type { Reference } from "./types";
import { authorYearMarker } from "./citation";

export type CitationProposal = { quote: string; refId: string; reason: string };
export type AnnotationItem = {
  proposal: CitationProposal;
  ref: Reference;
  insertAt: number; // 元本文のオフセット。この直前にマーカーを挿す（＝句点の直前）
  marker: string; // authorYearMarker(ref)
};
export type SkippedItem = {
  proposal: CitationProposal;
  ref?: Reference;
  why: "no-match" | "ambiguous" | "unknown-ref" | "already-cited";
};
export type AnnotationPlan = { applied: AnnotationItem[]; needsManual: SkippedItem[] };

const SENTENCE_END = /[。！？]/;

/** quoteEnd から同じ行内で最初の文末記号の直前。無ければ行末/本文末。 */
function markerPosition(body: string, quoteEnd: number): number {
  for (let i = quoteEnd; i < body.length; i++) {
    const c = body[i];
    if (c === "\n") return i;
    if (SENTENCE_END.test(c)) return i;
  }
  return body.length;
}

/** insertAt の属する文（直近の文頭〜次の文末/行末）に既存マーカー〔…〕があるか。 */
function sentenceAlreadyCited(body: string, insertAt: number): boolean {
  let start = 0;
  for (let i = insertAt - 1; i >= 0; i--) {
    const c = body[i];
    if (c === "\n" || SENTENCE_END.test(c)) {
      start = i + 1;
      break;
    }
  }
  let end = body.length;
  for (let i = insertAt; i < body.length; i++) {
    const c = body[i];
    if (c === "\n" || SENTENCE_END.test(c)) {
      end = i;
      break;
    }
  }
  return /〔[^〕]*〕/.test(body.slice(start, end));
}

/** proposals を元本文に対して検証し、挿入計画を作る（本文はまだ変えない）。 */
export function planAnnotations(
  body: string,
  proposals: CitationProposal[],
  refs: Reference[],
): AnnotationPlan {
  const byId = new Map(refs.map((r) => [r.id, r]));
  const applied: AnnotationItem[] = [];
  const needsManual: SkippedItem[] = [];
  const seen = new Set<string>(); // `${insertAt}::${refId}` dedup

  proposals.forEach((proposal) => {
    const ref = byId.get(proposal.refId);
    if (!ref) {
      needsManual.push({ proposal, why: "unknown-ref" });
      return;
    }
    const first = body.indexOf(proposal.quote);
    if (first === -1) {
      needsManual.push({ proposal, ref, why: "no-match" });
      return;
    }
    if (body.indexOf(proposal.quote, first + 1) !== -1) {
      needsManual.push({ proposal, ref, why: "ambiguous" });
      return;
    }
    const insertAt = markerPosition(body, first + proposal.quote.length);
    if (sentenceAlreadyCited(body, insertAt)) {
      needsManual.push({ proposal, ref, why: "already-cited" });
      return;
    }
    const key = `${insertAt}::${ref.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    applied.push({ proposal, ref, insertAt, marker: authorYearMarker(ref) });
  });

  return { applied, needsManual };
}

/** 採用する applied 項目だけを元本文へ挿入して新本文を返す。 */
export function applyAnnotations(body: string, chosen: AnnotationItem[]): string {
  // insertAt 降順、同 insertAt は proposal 順の逆を二次キー（右→左 splice 後に proposal 順で並ぶ）。
  const order = new Map(chosen.map((c, i) => [c, i]));
  const sorted = [...chosen].sort(
    (a, b) => b.insertAt - a.insertAt || order.get(b)! - order.get(a)!,
  );
  let out = body;
  for (const item of sorted) {
    out = out.slice(0, item.insertAt) + item.marker + out.slice(item.insertAt);
  }
  return out;
}
```

- [ ] **Step 4: 型チェック**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24.15.0 >/dev/null; npx tsc --noEmit`
Expected: エラーなし。

- [ ] **Step 5: コミット**

```bash
git add src/lib/citationAnnotate.ts
git -c user.name="Will" -c user.email="tachiiri@westernavenu.com" commit -m "$(printf 'feat: 引用差し込みの純粋ロジック planAnnotations/applyAnnotations（厳密一致・句点基準・dedup・再実行安全）\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 2: ワークフロー＋API＋クライアント helper

**Files:**
- Create: `src/workflows/citationAnnotate.ts`
- Create: `src/app/api/annotate-citations/route.ts`
- Modify: `src/lib/translationClient.ts`

**Interfaces:**
- Consumes: `CitationProposal`（Task 1）、`Reference`、`authorYearMarker`（既存）、`runAiStep`（`./shared`）、`safeJsonParse`（`@/lib/json`）、`postJson`（`translationClient` 内・既存）。
- Produces: `annotateCitationsWorkflow`、`POST /api/annotate-citations`、`annotateSectionCitations(body, references, field?, researchQuestion?): Promise<CitationProposal[]>`（Task 4 が consume）。

- [ ] **Step 0: 裏取り**

Run:
- `grep -n 'export async function runAiStep' src/workflows/shared.ts` → 1件（`{ parsed, raw, attempts, model, provider, timedOut }` を返す）。
- `grep -n 'export function safeJsonParse' src/lib/json.ts` → 1件。
- `grep -n 'async function postJson\|export async function startSectionDraft' src/lib/translationClient.ts` → `postJson` と `startSectionDraft` が存在（postJson の戻りは `{ ok, data?, error? }`）。

- [ ] **Step 1: ワークフロー `src/workflows/citationAnnotate.ts` を作成（`referenceCard.ts` に倣う・プロンプトはインライン）**

```ts
import { getWorkflowMetadata } from "workflow";
import type { Reference } from "@/lib/types";
import { authorYearMarker } from "@/lib/citation";
import { safeJsonParse } from "@/lib/json";
import { runAiStep } from "./shared";
import type { CitationProposal } from "@/lib/citationAnnotate";

export type AnnotateCitationsInput = {
  body: string;
  references: Reference[];
  field?: string;
  researchQuestion?: string;
};

export type AnnotateCitationsResult =
  | {
      ok: true;
      proposals: CitationProposal[];
      meta: { model: string; provider: string; attempts: number; runId: string };
    }
  | {
      ok: false;
      error: string;
      raw?: string;
      meta: { model: string; provider: string; attempts: number; runId: string };
    };

export async function annotateCitationsWorkflow(
  input: AnnotateCitationsInput,
): Promise<AnnotateCitationsResult> {
  "use workflow";
  const runId = getWorkflowMetadata().workflowRunId;
  return annotateCitationsStep(input, runId);
}

async function annotateCitationsStep(
  input: AnnotateCitationsInput,
  runId: string,
): Promise<AnnotateCitationsResult> {
  "use step";

  const refsBlock = input.references
    .map(
      (r) =>
        `- refId=${r.id} ${authorYearMarker(r)} ${r.title}${r.author ? ` / ${r.author}` : ""}${
          r.year ? ` (${r.year})` : ""
        }${r.notes ? ` — ${r.notes}` : ""}`,
    )
    .join("\n");

  const system =
    "あなたは学術論文の編集者です。登録済みの参考文献が明確に支持する主張にだけ引用を付けます。本文の文章は一切変えません（言い換え・要約・加筆・約物や全角半角の変更も禁止）。";

  const user = [
    `分野: ${input.field || "（未設定）"}`,
    `リサーチクエスチョン: ${input.researchQuestion || "（未設定）"}`,
    `# 登録文献`,
    refsBlock,
    `# 本文`,
    input.body.slice(0, 14000),
    `# 指示`,
    "本文中で、上の登録文献が明確に支持する主張にだけ引用を付けてください。無ければ付けない。",
    "各引用について、その主張を含む文の逐語断片を quote に、本文から一字一句そのままコピーしてください（全角半角・鉤括弧・ダッシュ等を勝手に正規化しない。本文中で一意に定まる長さにする）。マーカーの正確な挿入位置はシステムが句点基準で決めるので、quote は句点で切らなくてよい。",
    "refId は上の登録文献のIDのみ。reason は選定根拠を短く。",
    '出力は次のJSONのみ（他の文字は禁止）: {"proposals":[{"quote":"…","refId":"…","reason":"…"}]}',
  ].join("\n\n");

  const result = await runAiStep(
    {
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      maxTokens: 4000,
      maxAttempts: 2,
    },
    (raw) => {
      const parsed = safeJsonParse<{ proposals?: unknown }>(raw);
      if (!parsed || !Array.isArray(parsed.proposals)) return null;
      const out: CitationProposal[] = [];
      for (const p of parsed.proposals as unknown[]) {
        const o = (p ?? {}) as Record<string, unknown>;
        const quote = typeof o.quote === "string" ? o.quote : "";
        const refId = typeof o.refId === "string" ? o.refId : "";
        const reason = typeof o.reason === "string" ? o.reason : "";
        if (quote && refId) out.push({ quote, refId, reason });
      }
      return out; // 空配列も有効な結果（引用なしと解釈）
    },
  );

  if (!result.parsed) {
    return {
      ok: false,
      error: result.timedOut
        ? "引用候補の生成が制限時間内に完了しませんでした。本文を短くして再試行してください。"
        : "AI出力をJSONとして解釈できませんでした。もう一度お試しください。",
      raw: result.raw,
      meta: { model: result.model, provider: result.provider, attempts: result.attempts, runId },
    };
  }
  return {
    ok: true,
    proposals: result.parsed,
    meta: { model: result.model, provider: result.provider, attempts: result.attempts, runId },
  };
}
```

- [ ] **Step 2: API route `src/app/api/annotate-citations/route.ts` を作成（`extract-reference-card` に倣う同期await型）**

```ts
import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { AIConfigError } from "@/lib/ai";
import { annotateCitationsWorkflow } from "@/workflows/citationAnnotate";

export const runtime = "nodejs";

/**
 * 論文モード: 既存本文＋登録文献から「引用の差し込み候補（位置＋文献ID）」を返す。
 * 本文は書き換えず、位置決め・挿入はクライアントが planAnnotations/applyAnnotations で行う。
 */
export async function POST(req: Request) {
  let input: unknown;
  try {
    input = await req.json();
  } catch {
    return NextResponse.json({ error: "リクエストの解釈に失敗しました。" }, { status: 400 });
  }
  const o = (input ?? {}) as Record<string, unknown>;
  const body = typeof o.body === "string" ? o.body : "";
  const references = Array.isArray(o.references) ? o.references : [];
  if (!body.trim()) {
    return NextResponse.json({ error: "本文がありません。" }, { status: 400 });
  }
  if (references.length === 0) {
    return NextResponse.json({ error: "参考文献が登録されていません。" }, { status: 400 });
  }

  try {
    const run = await start(annotateCitationsWorkflow, [
      {
        body,
        references,
        field: String(o.field ?? ""),
        researchQuestion: String(o.researchQuestion ?? ""),
      },
    ]);
    const result = await run.returnValue;
    if (!result.ok) {
      return NextResponse.json({ error: result.error, runId: result.meta.runId }, { status: 502 });
    }
    return NextResponse.json({ proposals: result.proposals, runId: result.meta.runId });
  } catch (e) {
    if (e instanceof AIConfigError) {
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[annotate-citations] workflow error", msg);
    return NextResponse.json({ error: `引用候補の生成に失敗しました：${msg}` }, { status: 500 });
  }
}
```

- [ ] **Step 3: クライアント helper を `src/lib/translationClient.ts` に追加**

`export async function startSectionDraft(` を検索し、その**直前**に追加:

```ts
export async function annotateSectionCitations(
  body: string,
  references: Reference[],
  field?: string,
  researchQuestion?: string,
): Promise<import("./citationAnnotate").CitationProposal[]> {
  const r = await postJson<{ proposals?: import("./citationAnnotate").CitationProposal[] }>(
    "/api/annotate-citations",
    { body, references, field: field ?? "", researchQuestion: researchQuestion ?? "" },
  );
  if (!r.ok) throw new Error(r.error ?? "引用候補の生成に失敗しました。");
  return r.data?.proposals ?? [];
}

```

（`Reference` 型が同ファイルで未 import なら `import type { Reference } from "./types";` を既存の型 import に足す。`grep -n 'from "./types"' src/lib/translationClient.ts` で確認し、無ければ追加。`postJson` は同ファイル内の既存関数。）

- [ ] **Step 4: 型チェック＋ビルド**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24.15.0 >/dev/null; npx tsc --noEmit && npx next build 2>&1 | grep -iE "Failed|error:|✓ Generating"`
Expected: tsc エラーなし・`✓ Generating static pages`。`/api/annotate-citations` がビルド対象に含まれる。

- [ ] **Step 5: コミット**

```bash
git add src/workflows/citationAnnotate.ts src/app/api/annotate-citations/route.ts src/lib/translationClient.ts
git -c user.name="Will" -c user.email="tachiiri@westernavenu.com" commit -m "$(printf 'feat: 引用差し込み候補のワークフロー＋API＋クライアント（位置+文献IDのみ返す・同期await型）\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 3: 保存ヘルパ `applyCitationAnnotationsSave`（storage）

**Files:**
- Modify: `src/lib/storage.ts`

**Interfaces:**
- Consumes: `updateProject`（同ファイル内・既存）。
- Produces: `applyCitationAnnotationsSave(chapterId, sectionId, newBody): Project`（Task 4 が consume）。

- [ ] **Step 0: 裏取り**

Run:
- `grep -n 'export function replaceDraftBody' src/lib/storage.ts` → 1件（常時1版退避のパターン）。
- `grep -n 'lockReason: "manual" as const' src/lib/storage.ts` → `saveManualBodyEdit` の自動ロック表現が存在（同じ書き方に合わせる）。

- [ ] **Step 1: ヘルパを追加**

`export function saveManualBodyEdit(` を検索し、その**直前**に追加:

```ts
/**
 * AI引用差し込みの反映を保存する（論文モード）。
 * - 旧本文を必ず1版 bodyHistory に退避（圧縮しない＝「変更差分」から retrofit 前へ復元できる）。
 * - PR-A と同じ自動保護: bodyEditedAt を更新し、未ロックなら locked=true/lockReason="manual"。
 */
export function applyCitationAnnotationsSave(
  chapterId: string,
  sectionId: string,
  newBody: string,
): Project {
  const nowIso = new Date().toISOString();
  return updateProject((p) => ({
    ...p,
    generatedSections: p.generatedSections.map((d) => {
      if (d.chapterId !== chapterId || d.sectionId !== sectionId) return d;
      if (d.body === newBody) return d;
      const bodyHistory = [
        ...(d.bodyHistory ?? []),
        { savedAt: d.updatedAt, body: d.body, note: "AI引用差し込み前" },
      ].slice(-10);
      const autoLockNow = !d.bodyEditedAt && !d.locked;
      return {
        ...d,
        body: newBody,
        bodyHistory,
        bodyEditedAt: nowIso,
        ...(autoLockNow ? { locked: true, lockReason: "manual" as const } : {}),
        updatedAt: nowIso,
      };
    }),
  }));
}

```

- [ ] **Step 2: 純粋サニティ（scratchpad node で退避・ロックの分岐を確認）**

scratchpad `pr-b4-save.mjs`（ロジックのみ移植・localStorage 不要）:

```js
function save(d,newBody){const now="T2";if(d.body===newBody)return d;
  const bodyHistory=[...(d.bodyHistory??[]),{savedAt:d.updatedAt,body:d.body,note:"AI引用差し込み前"}].slice(-10);
  const autoLockNow=!d.bodyEditedAt&&!d.locked;
  return {...d,body:newBody,bodyHistory,bodyEditedAt:now,...(autoLockNow?{locked:true,lockReason:"manual"}:{}),updatedAt:now};}
// 未編集・未ロック → 自動ロック＋1版退避
const a=save({body:"旧",updatedAt:"T1"},"新〔X, 2020〕");
console.log("locked:",a.locked,"reason:",a.lockReason,"histLen:",a.bodyHistory.length,"histBody:",a.bodyHistory[0].body,"note:",a.bodyHistory[0].note);
// 既にユーザーが解除済み（bodyEditedApあり）→ 再ロックしない
const b=save({body:"旧",updatedAt:"T1",bodyEditedAt:"T0"},"新");
console.log("noRelock:",!!b.locked, "hist:",b.bodyHistory.length);
// 同一本文 → 変更なし
console.log("noop:",save({body:"同",updatedAt:"T1"},"同").body==="同");
```

Run: `node /tmp/pr-b4-save.mjs`
Expected:
```
locked: true reason: manual histLen: 1 histBody: 旧 note: AI引用差し込み前
noRelock: false hist: 1
noop: true
```
（未編集節は自動ロック＋旧版退避、解除済み節は再ロックしない、旧本文は必ず1版残る。）

- [ ] **Step 3: 型チェック**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24.15.0 >/dev/null; npx tsc --noEmit`
Expected: エラーなし。

- [ ] **Step 4: コミット**

```bash
git add src/lib/storage.ts
git -c user.name="Will" -c user.email="tachiiri@westernavenu.com" commit -m "$(printf 'feat: applyCitationAnnotationsSave（retrofit反映=常時1版退避＋PR-A自動ロック・coalesce回避）\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 4: `/writer` UI（ボタン・レビュー一覧・採用適用）

**Files:**
- Modify: `src/app/writer/page.tsx`

**Interfaces:**
- Consumes: `annotateSectionCitations`（Task 2）、`planAnnotations`/`applyAnnotations`/`AnnotationPlan`/`AnnotationItem`（Task 1）、`applyCitationAnnotationsSave`（Task 3）。

- [ ] **Step 0: 裏取り**

Run（各1件で一意であることを確認）:
- `grep -c 'const \[citePickerOpen, setCitePickerOpen\]' src/app/writer/page.tsx` → **1**（state 追加のアンカー）。
- `grep -c 'function handleSaveBody() {' src/app/writer/page.tsx` → **1**（ハンドラ追加のアンカー）。
- `grep -c '{isTranslation ? "訳文を編集" : "本文を編集"}' src/app/writer/page.tsx` → **1**（ボタン追加のアンカー）。
- `grep -nE '^                </div>$' src/app/writer/page.tsx | head` と `grep -c '                {editingHeading ? (' src/app/writer/page.tsx` → パネル挿入アンカー（`</div>\n                </div>\n                {editingHeading ? (`）が一意であることを確認。

- [ ] **Step 1: import を追加**

`translationClient` からの既存 import に `annotateSectionCitations` を足し、新規 import を2行足す。`from "@/lib/translationClient"` の import 文を検索し `annotateSectionCitations` を追加。あわせてファイル上部の import 群（他の `@/lib/...` import の並び）に:

```tsx
import { planAnnotations, applyAnnotations } from "@/lib/citationAnnotate";
import type { AnnotationPlan, AnnotationItem } from "@/lib/citationAnnotate";
```

`applyCitationAnnotationsSave` を storage の既存 import に足す（`from "@/lib/storage"` を検索し、そのリストに `applyCitationAnnotationsSave,` を追加）。

- [ ] **Step 2: state を追加**

`const [citePickerOpen, setCitePickerOpen] = useState(false);` を検索し、その**直後**に追加:

```tsx
  const [annotating, setAnnotating] = useState(false);
  const [annotatePlan, setAnnotatePlan] = useState<AnnotationPlan | null>(null);
  const [annotateChecked, setAnnotateChecked] = useState<Set<AnnotationItem>>(new Set());
```

- [ ] **Step 3: ハンドラを追加**

`function handleSaveBody() {` を検索し、その**直前**に追加（いずれもフックではない関数宣言なので早期return後でも可）:

```tsx
  // 論文モード: 既存本文にAIで引用マーカーを差し込む候補を出す（本文は変えずレビューに載せる）
  async function handleAnnotateCitations() {
    if (!project || !selected || !currentDraft) return;
    setAnnotating(true);
    setError(null);
    try {
      const refs = project.references ?? [];
      const proposals = await annotateSectionCitations(
        currentDraft.body,
        refs,
        project.paperMeta?.field ?? "",
        project.paperMeta?.researchQuestion ?? "",
      );
      const plan = planAnnotations(currentDraft.body, proposals, refs);
      setAnnotatePlan(plan);
      setAnnotateChecked(new Set(plan.applied)); // 既定は全採用
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAnnotating(false);
    }
  }

  function toggleAnnotateItem(item: AnnotationItem, checked: boolean) {
    setAnnotateChecked((prev) => {
      const next = new Set(prev);
      if (checked) next.add(item);
      else next.delete(item);
      return next;
    });
  }

  // 採用した候補だけを元本文に挿入して保存（地の文は不変・旧版退避＋自動ロック）
  function handleApplyAnnotations() {
    if (!project || !selected || !currentDraft || !annotatePlan) return;
    const chosen = annotatePlan.applied.filter((it) => annotateChecked.has(it));
    if (chosen.length === 0) {
      setAnnotatePlan(null);
      return;
    }
    const newBody = applyAnnotations(currentDraft.body, chosen);
    const next = applyCitationAnnotationsSave(selected.chapter.id, selected.section.id, newBody);
    setProject(next);
    setAnnotatePlan(null);
    setAnnotateChecked(new Set());
  }
```

- [ ] **Step 4: 「AIで引用を差し込む」ボタンを追加**

`本文を編集` ボタンのブロックを検索して置換（`本文を編集` の直後に論文専用ボタンを足す）:

置換前:
```tsx
                    {currentDraft && !editingBody ? (
                      <button className="btn" onClick={handleStartEditBody} type="button">
                        {isTranslation ? "訳文を編集" : "本文を編集"}
                      </button>
                    ) : null}
```
置換後:
```tsx
                    {currentDraft && !editingBody ? (
                      <button className="btn" onClick={handleStartEditBody} type="button">
                        {isTranslation ? "訳文を編集" : "本文を編集"}
                      </button>
                    ) : null}
                    {project.genre === "paper" &&
                    currentDraft &&
                    !editingBody &&
                    (project.references?.length ?? 0) > 0 ? (
                      <button
                        className="btn"
                        type="button"
                        onClick={handleAnnotateCitations}
                        disabled={annotating}
                        title="登録文献をもとに、本文を書き換えずに引用マーカーを差し込む候補を出します"
                      >
                        {annotating ? <span className="spinner" /> : null}
                        AIで引用を差し込む
                      </button>
                    ) : null}
```

- [ ] **Step 5: レビュー一覧パネルを追加**

ボタン列（`</div>`）とパネルヘッダ（`</div>`）の閉じ、`{editingHeading ? (` の**直前**にパネルを挿入。次を検索して置換:

置換前:
```tsx
                  </div>
                </div>
                {editingHeading ? (
```
置換後:
```tsx
                  </div>
                </div>
                {annotatePlan ? (
                  <div
                    className="panel-body"
                    style={{ borderBottom: "1px solid var(--border)", background: "var(--panel-alt)" }}
                  >
                    <div className="field-label">
                      引用の差し込み候補（チェックした分だけ本文に入ります・地の文は変わりません）
                    </div>
                    {annotatePlan.applied.length === 0 ? (
                      <p className="help">差し込み可能な候補はありませんでした。</p>
                    ) : (
                      <ul className="list-block" style={{ border: "1px solid var(--border)", borderRadius: 3 }}>
                        {annotatePlan.applied.map((item, i) => (
                          <li key={i}>
                            <label className="staff-toggle" style={{ gap: 8, alignItems: "flex-start" }}>
                              <input
                                type="checkbox"
                                checked={annotateChecked.has(item)}
                                onChange={(e) => toggleAnnotateItem(item, e.target.checked)}
                              />
                              <span style={{ fontSize: 12 }}>
                                <strong>{item.marker}</strong>
                                <span className="muted">
                                  {" ― "}
                                  {item.proposal.quote}
                                </span>
                                {item.proposal.reason ? (
                                  <span className="muted" style={{ display: "block" }}>
                                    根拠: {item.proposal.reason}
                                  </span>
                                ) : null}
                              </span>
                            </label>
                          </li>
                        ))}
                      </ul>
                    )}
                    {annotatePlan.needsManual.length > 0 ? (
                      <details style={{ marginTop: 8 }}>
                        <summary>要手動（{annotatePlan.needsManual.length}件・本文と一致せず／曖昧／既に引用あり）</summary>
                        <ul className="list-block">
                          {annotatePlan.needsManual.map((s, i) => (
                            <li key={i} style={{ fontSize: 12 }}>
                              {s.ref ? authorYearMarker(s.ref) : s.proposal.refId}
                              <span className="muted">
                                {" ["}
                                {s.why}
                                {"] "}
                                {s.proposal.quote}
                              </span>
                            </li>
                          ))}
                        </ul>
                        <p className="help">
                          これらは「本文を編集 → 引用を挿入」で手挿ししてください（該当文にカーソルを置いて選択）。
                        </p>
                      </details>
                    ) : null}
                    <div className="flex" style={{ marginTop: 10, gap: 8 }}>
                      <button
                        className="btn primary"
                        type="button"
                        onClick={handleApplyAnnotations}
                        disabled={annotateChecked.size === 0}
                      >
                        選択を本文に反映（{annotateChecked.size}件）
                      </button>
                      <button className="btn" type="button" onClick={() => setAnnotatePlan(null)}>
                        キャンセル
                      </button>
                    </div>
                  </div>
                ) : null}
                {editingHeading ? (
```

（`authorYearMarker` は writer で未 import なら `import { authorYearMarker } from "@/lib/citation";` を足す。`grep -c 'authorYearMarker' src/app/writer/page.tsx` が 0 なら追加、1以上なら既に import 済み＝PR-B2 で導入済み。）

- [ ] **Step 6: 型チェック＋ビルド**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24.15.0 >/dev/null; npx tsc --noEmit && npx next build 2>&1 | grep -iE "Failed|error:|✓ Generating"`
Expected: tsc エラーなし・`✓ Generating static pages`。

- [ ] **Step 7: コミット**

```bash
git add src/app/writer/page.tsx
git -c user.name="Will" -c user.email="tachiiri@westernavenu.com" commit -m "$(printf 'feat: /writer に「AIで引用を差し込む」＝候補レビュー→1件ずつ採用で本文へ機械挿入（論文）\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 5: 実機検証（コントローラ）

**Files:** 変更なし（検証のみ）。不具合は該当 Task に戻す。

- [ ] **Step 1: ブラウザで seed→候補→採用→反映（AIはモックで照合・挿入・保存を検証）**

論文プロジェクトを seed（本文はマーカー無し・登録文献複数・節1つ）。ローカルにAIキーが無い場合、`/api/annotate-citations` の実呼び出しは失敗し得るので、**検証の主目的は planAnnotations→applyAnnotations→保存の経路**。`preview_start`（該当 worktree で `next dev`）→ `/writer` を開き、`javascript_tool` で既知の proposals（本文中の逐語 quote＋登録 refId）を使って `handleAnnotateCitations` 相当を再現するか、`annotateSectionCitations` をモックにして候補一覧を出す。

- [ ] **Step 2: 反映の確認**

- 候補を数件チェック →「選択を本文に反映」→ 本文の**該当文の句点直前**にマーカーが入る。地の文はマーカー以外差分ゼロ（`javascript_tool` で反映前後の本文文字列を比較し、挿入マーカーを除けば一致）。
- 反映後、`localStorage` の当該 `SectionDraft` に `locked=true`/`lockReason="manual"`/`bodyEditedAt` が付き、`bodyHistory` の末尾 note が `"AI引用差し込み前"`。
- 「本文を編集」で開くと挿入済みマーカーが本文に見える。`read_console_messages`（onlyErrors）でエラー0。

- [ ] **Step 3: 再実行安全＆要手動**

- 同じ節でもう一度実行 → 既にマーカーがある文は候補（applied）に出ない（already-cited）。
- 本文に無い quote／複数箇所ヒットの quote を含むモック → 「要手動」に分類され本文に入らない。

- [ ] **Step 4: 回帰**

`本文を再生成`／`本文を編集`（PR-A/B2 ピッカー）／`citation-check`／Word出力（体裁・和文脚注 PR-B3）が無改修で従来どおり。翻訳プロジェクトで「AIで引用を差し込む」ボタンが出ない（論文限定）。console エラーなし。

- [ ] **Step 5: 記録**

コード変更が出たら該当 Task に戻して修正・再検証。無ければコミット無しで完了。検証要点（句点直前挿入・地の文差分ゼロ・自動ロック・旧版退避・再実行安全）を PR 説明に添える。

---

## Self-Review（スペック突合）

- **節ごと・ボタン1つ**（spec ①）→ Task 4 Step 4 ✅
- **AIは位置+refIdだけ返す・同期await型**（spec ②③）→ Task 2 ✅
- **厳密一致・元本文オフセット・句点基準のマーカー位置**（spec ④・🔴1/🔴2）→ Task 1（`markerPosition`・`indexOf` 厳密）＋ Step 1-2 で検証 ✅
- **dedup (insertAt,refId)＋proposal順**（spec ④・🟡3）→ Task 1（`seen`＋`applyAnnotations` 二次キー）✅
- **already-cited で再実行安全**（spec ④・🟡4）→ Task 1（`sentenceAlreadyCited`）＋ Task 5 Step 3 ✅
- **1件ずつ採否・要手動別掲**（spec ①③）→ Task 4 Step 5 ✅
- **候補は全登録文献・notes/カルテ込み**（spec 決定4）→ Task 2（refsBlock）✅
- **保存=常時1版退避＋自動ロック（coalesce回避）**（spec ⑤）→ Task 3 ✅
- **markerは空にならない（title fallback）**（spec ④）→ `authorYearMarker` 既存挙動、Task 1 で使用 ✅
- **非スコープ**（地の文書換え・新規文献・全文一括/全自動・体裁変換・曖昧自動解決・同年付番）→ 本計画に含めない ✅
- **maxTokens大きめ＋retry・field/researchQuestion は paperMeta 由来**（spec ②③）→ Task 2 ✅

Placeholder スキャン: 曖昧語なし・全コードブロック実体あり。型整合: `CitationProposal`/`AnnotationItem`/`AnnotationPlan`/`planAnnotations`/`applyAnnotations`/`annotateSectionCitations`/`applyCitationAnnotationsSave` は Task 間で一致。純粋ロジック（Task 1）を先に固める設計（レビュー助言）に沿ってタスク順を Task 1 → 2/3 → 4 とした。
```
