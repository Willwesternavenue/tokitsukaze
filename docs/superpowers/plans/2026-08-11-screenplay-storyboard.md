# 脚本モード 絵コンテ生成（MVP） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 脚本の各シーンから Nano Banana（Gemini画像）でシネマティックな静止画（絵コンテ）を1枚生成し、Vercel Blob に保存して writer 上のシーンに紐づけて表示する。

**Architecture:** 軽量な同期APIルート `/api/generate-storyboard` が「決定的プロンプト構築 → 画像生成 → Blob保存 → URL返却」を1リクエストで完結。既存の Vercel Workflow / `ai.ts`（テキスト専用）には触れない。生成画像は Blob に置き、localStorage には URL とメタのみ保存する。

**Tech Stack:** Next.js 14 App Router / TypeScript / Google Generative Language REST API（画像出力）/ `@vercel/blob` / vitest（新規・純関数テスト用）

## Global Constraints

- 作業ブランチ: `claude/screenplay-storyboard`（worktree: `/Users/will/tokitsukaze/.claude/worktrees/vibrant-feistel-5de2b8`）。
- Node は tsc/build/test 実行時に `source ~/.nvm/nvm.sh && nvm use 24.15.0`。
- コミットは `git -c user.name="Will" -c user.email="tachiiri@westernavenu.com" commit`、本文末尾に `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。
- **脚本（`genre === "screenplay"`）専用**。他ジャンルのUI/挙動は変えない。
- **`src/lib/ai.ts` と `src/workflows/*` には手を入れない**（画像は別層）。
- 絵コンテは **`SectionDraft.storyboard`** に保持（1シーン1枚・上書き・配列にしない）。
- 画像モデル: 既定 `gemini-3.1-flash-image`（env `GEMINI_IMAGE_MODEL` で上書き）、キーは `GOOGLE_API_KEY`。Blob は `BLOB_READ_WRITE_TOKEN`。
- 固定スタイル接尾辞（定数）: `cinematic film still, color, dramatic cinematic lighting, cohesive art direction, no text, no watermark`。
- 各タスク完了時に `nvm use 24.15.0 && npx tsc --noEmit` が通ること。

---

### Task 1: テストハーネス（vitest）を追加

**Files:**
- Modify: `package.json`（devDependency と `test` スクリプト）
- Create: `vitest.config.ts`
- Create: `src/lib/__tests__/smoke.test.ts`

**Interfaces:**
- Produces: `npm test`（=vitest run）が実行でき、`@/` エイリアスと TS/拡張子なし相対 import を解決する。

- [ ] **Step 1: vitest を dev 依存に追加**

Run:
```bash
source ~/.nvm/nvm.sh && nvm use 24.15.0
cd /Users/will/tokitsukaze/.claude/worktrees/vibrant-feistel-5de2b8
npm install -D vitest@^2
```

- [ ] **Step 2: `vitest.config.ts` を作成**

```ts
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 3: `package.json` に test スクリプト追加**

`"scripts"` に次を追加（既存行は残す）:
```json
"test": "vitest run"
```

- [ ] **Step 4: スモークテストを作成**

`src/lib/__tests__/smoke.test.ts`:
```ts
import { describe, it, expect } from "vitest";

describe("harness", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: テスト実行して PASS を確認**

Run: `npm test`
Expected: 1 passed。

- [ ] **Step 6: コミット**

```bash
git add package.json package-lock.json vitest.config.ts src/lib/__tests__/smoke.test.ts
git -c user.name="Will" -c user.email="tachiiri@westernavenu.com" commit -m "test: vitest ハーネスを追加

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: プロンプト構築（純関数 `buildStoryboardPrompt`）

**Files:**
- Create: `src/lib/storyboardPrompt.ts`
- Test: `src/lib/storyboardPrompt.test.ts`

**Interfaces:**
- Consumes: `parseScreenplayBody` from `@/lib/screenplay`; 型 `SceneMeta`, `ReferenceCharacterCard` from `@/lib/types`。
- Produces:
  ```ts
  export type StoryboardPromptInput = {
    sceneTitle?: string;
    sceneMeta?: SceneMeta;
    body: string;
    characters?: ReferenceCharacterCard[];
  };
  export function buildStoryboardPrompt(input: StoryboardPromptInput): string;
  export const STORYBOARD_STYLE_SUFFIX: string;
  ```

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/storyboardPrompt.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildStoryboardPrompt, STORYBOARD_STYLE_SUFFIX } from "@/lib/storyboardPrompt";
import type { SceneMeta, ReferenceCharacterCard } from "@/lib/types";

const meta: SceneMeta = {
  intExt: "INT",
  location: "古い印刷所",
  timeOfDay: "NIGHT",
  purpose: "主人公が父の遺した活版印刷機と対面する",
  presentCharacters: ["ハル"],
};
const body = [
  "○ 古い印刷所（INT・夜）",
  "　埃をかぶった活版印刷機。ハルがゆっくり近づく。",
  "ハル",
  "「まだ、動くのか……」",
].join("\n");
const chars: ReferenceCharacterCard[] = [
  { name: "ハル", voice: "静かで訥々", keyLines: [], facts: ["20代女性", "黒髪のショートヘア", "作業着"] },
];

describe("buildStoryboardPrompt", () => {
  it("sceneMeta の各要素をプロンプトに含める", () => {
    const p = buildStoryboardPrompt({ sceneMeta: meta, body, characters: chars });
    expect(p).toContain("INT");
    expect(p).toContain("古い印刷所");
    expect(p).toContain("NIGHT");
    expect(p).toContain("主人公が父の遺した活版印刷機と対面する");
  });

  it("ト書き（action行）の内容を含める", () => {
    const p = buildStoryboardPrompt({ sceneMeta: meta, body, characters: chars });
    expect(p).toContain("活版印刷機");
  });

  it("登場キャラの設定(facts)を注入する（②テキスト一貫性）", () => {
    const p = buildStoryboardPrompt({ sceneMeta: meta, body, characters: chars });
    expect(p).toContain("ハル");
    expect(p).toContain("黒髪のショートヘア");
  });

  it("スタイル接尾辞を必ず付ける", () => {
    const p = buildStoryboardPrompt({ sceneMeta: meta, body, characters: chars });
    expect(p).toContain(STORYBOARD_STYLE_SUFFIX);
  });

  it("sceneMeta/characters が無くても throw しない", () => {
    expect(() => buildStoryboardPrompt({ body: "" })).not.toThrow();
    const p = buildStoryboardPrompt({ body: "" });
    expect(p).toContain(STORYBOARD_STYLE_SUFFIX);
  });

  it("action行が長い場合は字数上限で切り詰める（AIは呼ばない・決定的）", () => {
    const long = "　" + "あ".repeat(2000);
    const p = buildStoryboardPrompt({ sceneMeta: meta, body: long });
    // 上限 600 + 余白程度に収まる（本文まるごとは載らない）
    expect(p.length).toBeLessThan(1500);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npm test -- src/lib/storyboardPrompt.test.ts`
Expected: FAIL（`buildStoryboardPrompt` 未定義）。

- [ ] **Step 3: 最小実装を書く**

`src/lib/storyboardPrompt.ts`:
```ts
import { parseScreenplayBody } from "@/lib/screenplay";
import type { SceneMeta, ReferenceCharacterCard } from "@/lib/types";

export type StoryboardPromptInput = {
  sceneTitle?: string;
  sceneMeta?: SceneMeta;
  body: string;
  characters?: ReferenceCharacterCard[];
};

export const STORYBOARD_STYLE_SUFFIX =
  "cinematic film still, color, dramatic cinematic lighting, cohesive art direction, no text, no watermark";

const ACTION_CHAR_LIMIT = 600;

/** ト書き(action)行だけを決定的に連結し、字数上限で切り詰める。AI呼び出しはしない。 */
function condenseAction(body: string): string {
  const lines = parseScreenplayBody(body);
  const action = lines
    .filter((l) => l.kind === "action")
    .map((l) => (l as { text: string }).text.trim())
    .filter(Boolean)
    .join(" ");
  return action.length > ACTION_CHAR_LIMIT ? action.slice(0, ACTION_CHAR_LIMIT) + "…" : action;
}

function describeCharacters(input: StoryboardPromptInput): string {
  const present = input.sceneMeta?.presentCharacters ?? [];
  const cards = input.characters ?? [];
  const picked = present.length
    ? cards.filter((c) => present.includes(c.name))
    : cards;
  if (picked.length === 0) return "";
  const lines = picked.map((c) => {
    const facts = (c.facts ?? []).filter(Boolean).join("、");
    return `- ${c.name}: ${facts || "（外見設定なし）"}`;
  });
  return `Characters (keep them visually consistent):\n${lines.join("\n")}`;
}

export function buildStoryboardPrompt(input: StoryboardPromptInput): string {
  const m = input.sceneMeta;
  const sluglineParts = [
    m?.intExt,
    m?.location,
    m?.timeOfDay,
  ].filter(Boolean);
  const slug = sluglineParts.length ? `Scene: ${sluglineParts.join(" · ")}` : "";
  const purpose = m?.purpose ? `Dramatic intent: ${m.purpose}` : "";
  const action = condenseAction(input.body);
  const actionBlock = action ? `Action in frame: ${action}` : "";
  const chars = describeCharacters(input);

  const blocks = [
    "Create a single storyboard frame for a film scene.",
    slug,
    purpose,
    actionBlock,
    chars,
    `Style: ${STORYBOARD_STYLE_SUFFIX}`,
  ].filter(Boolean);

  return blocks.join("\n\n");
}
```

- [ ] **Step 4: テストを実行して PASS を確認**

Run: `npm test -- src/lib/storyboardPrompt.test.ts`
Expected: 6 passed。

- [ ] **Step 5: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし。

- [ ] **Step 6: コミット**

```bash
git add src/lib/storyboardPrompt.ts src/lib/storyboardPrompt.test.ts
git -c user.name="Will" -c user.email="tachiiri@westernavenu.com" commit -m "feat: 絵コンテのプロンプト構築（純関数・キャラ一貫性注入）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: 型追加（`Storyboard` / `SectionDraft.storyboard`）と保存ヘルパ

**Files:**
- Modify: `src/lib/types.ts`（`Storyboard` 型追加、`SectionDraft` に `storyboard?`）
- Modify: `src/lib/storage.ts`（`saveSectionStoryboard` 追加）

**Interfaces:**
- Consumes: `updateProject` from `@/lib/storage`（既存）。
- Produces:
  ```ts
  // types.ts
  export type Storyboard = { url: string; prompt: string; model: string; generatedAt: string };
  // SectionDraft に storyboard?: Storyboard

  // storage.ts
  export function saveSectionStoryboard(
    chapterId: string, sectionId: string, storyboard: Storyboard
  ): Project;
  ```

- [ ] **Step 1: `Storyboard` 型を追加**

`src/lib/types.ts` の `SectionDraft` 定義の直前に追加:
```ts
export type Storyboard = {
  url: string;         // Vercel Blob の公開URL
  prompt: string;      // 生成に使ったプロンプト
  model: string;       // 例: "gemini-3.1-flash-image"
  generatedAt: string; // ISO
};
```

- [ ] **Step 2: `SectionDraft` に `storyboard?` を追加**

`SectionDraft` 型の末尾フィールドに追加:
```ts
  storyboard?: Storyboard;
```

- [ ] **Step 3: 保存ヘルパを追加（`replaceDraftBody` と同じ `updateProject` パターン）**

`src/lib/storage.ts` の `replaceDraftBody` の直後に追加:
```ts
export function saveSectionStoryboard(
  chapterId: string,
  sectionId: string,
  storyboard: import("./types").Storyboard,
): Project {
  return updateProject((p) => ({
    ...p,
    generatedSections: p.generatedSections.map((d) =>
      d.chapterId === chapterId && d.sectionId === sectionId
        ? { ...d, storyboard }
        : d,
    ),
  }));
}
```

- [ ] **Step 4: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし。

- [ ] **Step 5: コミット**

```bash
git add src/lib/types.ts src/lib/storage.ts
git -c user.name="Will" -c user.email="tachiiri@westernavenu.com" commit -m "feat: Storyboard 型と saveSectionStoryboard 保存ヘルパ

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: 画像生成分離層（`imageGen.ts`）

**Files:**
- Create: `src/lib/imageGen.ts`
- Test: `src/lib/imageGen.test.ts`（純関数 `extractInlineImage` のみ）

**Interfaces:**
- Produces:
  ```ts
  export class ImageGenConfigError extends Error {}
  export function extractInlineImage(json: unknown): { bytes: Buffer; mime: string };
  export function generateStoryboardImage(prompt: string): Promise<{ bytes: Buffer; mime: string; model: string }>;
  ```

- [ ] **Step 1: 失敗するテストを書く（応答パースの純関数）**

`src/lib/imageGen.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { extractInlineImage } from "@/lib/imageGen";

const b64 = Buffer.from("hello").toString("base64");

describe("extractInlineImage", () => {
  it("camelCase inlineData を取り出す", () => {
    const json = { candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: b64 } }] } }] };
    const { bytes, mime } = extractInlineImage(json);
    expect(mime).toBe("image/png");
    expect(bytes.toString()).toBe("hello");
  });

  it("snake_case inline_data も取り出す", () => {
    const json = { candidates: [{ content: { parts: [{ inline_data: { mime_type: "image/webp", data: b64 } }] } }] };
    const { mime } = extractInlineImage(json);
    expect(mime).toBe("image/webp");
  });

  it("画像が無ければ throw", () => {
    expect(() => extractInlineImage({ candidates: [{ content: { parts: [{ text: "no image" }] } }] })).toThrow();
  });
});
```

- [ ] **Step 2: テスト実行して失敗を確認**

Run: `npm test -- src/lib/imageGen.test.ts`
Expected: FAIL（`extractInlineImage` 未定義）。

- [ ] **Step 3: 実装**

`src/lib/imageGen.ts`:
```ts
export class ImageGenConfigError extends Error {}

const DEFAULT_MODEL = "gemini-3.1-flash-image";

type InlineData = { data?: string; mimeType?: string; mime_type?: string };

export function extractInlineImage(json: unknown): { bytes: Buffer; mime: string } {
  const parts =
    (json as any)?.candidates?.[0]?.content?.parts ?? [];
  for (const p of parts) {
    const inline: InlineData | undefined = p?.inlineData ?? p?.inline_data;
    if (inline?.data) {
      return {
        bytes: Buffer.from(inline.data, "base64"),
        mime: inline.mimeType ?? inline.mime_type ?? "image/png",
      };
    }
  }
  throw new Error("画像データが応答に含まれていませんでした");
}

export async function generateStoryboardImage(
  prompt: string,
): Promise<{ bytes: Buffer; mime: string; model: string }> {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) throw new ImageGenConfigError("GOOGLE_API_KEY が未設定です。画像生成には Google のAPIキーが必要です。");
  const model = process.env.GEMINI_IMAGE_MODEL || DEFAULT_MODEL;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        // 一部モデルは ["TEXT","IMAGE"] を要求する。IMAGE 単独で失敗する場合は切替える（下の注記参照）。
        generationConfig: { responseModalities: ["IMAGE"] },
      }),
    },
  );
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`画像生成APIエラー (${res.status}): ${t.slice(0, 300)}`);
  }
  const json = await res.json();
  const { bytes, mime } = extractInlineImage(json);
  return { bytes, mime, model };
}
```

> **注記（実装者へ）:** 実キーで一度叩き、`responseModalities: ["IMAGE"]` が 400 になる場合は `["TEXT", "IMAGE"]` に変更する。既定モデル `gemini-3.1-flash-image` が本番で通らない場合、aiblog で実運用中の正しいモデルIDに `GEMINI_IMAGE_MODEL` を合わせる（本番エラーはモデルを替えず先に Google クレジット残を疑う、というのが過去の教訓）。

- [ ] **Step 4: テスト実行して PASS を確認**

Run: `npm test -- src/lib/imageGen.test.ts`
Expected: 3 passed。

- [ ] **Step 5: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし。

- [ ] **Step 6: コミット**

```bash
git add src/lib/imageGen.ts src/lib/imageGen.test.ts
git -c user.name="Will" -c user.email="tachiiri@westernavenu.com" commit -m "feat: Nano Banana 画像生成の分離層（Google REST）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: APIルート `/api/generate-storyboard`（Blob保存込み）

**Files:**
- Modify: `package.json`（`@vercel/blob` 追加）
- Create: `src/app/api/generate-storyboard/route.ts`

**Interfaces:**
- Consumes: `buildStoryboardPrompt`（Task 2）, `generateStoryboardImage`/`ImageGenConfigError`（Task 4）, `put` from `@vercel/blob`, 型 `Project`, `Storyboard`。
- Produces: `POST /api/generate-storyboard`。入力 `{ project: Project; chapterId: string; sectionId: string }`、成功時 `200 { url, prompt, model, generatedAt }`（= `Storyboard`）。

- [ ] **Step 1: `@vercel/blob` を追加**

Run:
```bash
source ~/.nvm/nvm.sh && nvm use 24.15.0
npm install @vercel/blob
```

- [ ] **Step 2: ルートを実装**

`src/app/api/generate-storyboard/route.ts`:
```ts
import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { buildStoryboardPrompt } from "@/lib/storyboardPrompt";
import { generateStoryboardImage, ImageGenConfigError } from "@/lib/imageGen";
import type { Project, ReferenceCharacterCard } from "@/lib/types";

export const runtime = "nodejs";

type Body = { project?: Project; chapterId?: string; sectionId?: string };

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "リクエスト本文が不正です。" }, { status: 400 });
  }
  const { project, chapterId, sectionId } = body ?? {};
  if (!project || !chapterId || !sectionId) {
    return NextResponse.json({ error: "必要なデータが不足しています。" }, { status: 400 });
  }
  if ((project as any).genre !== "screenplay") {
    return NextResponse.json({ error: "絵コンテ生成は脚本モード専用です。" }, { status: 400 });
  }

  const draft = project.generatedSections?.find(
    (d) => d.chapterId === chapterId && d.sectionId === sectionId,
  );
  const section = project.chapters
    ?.flatMap((c) => c.sections)
    .find((s) => s.id === sectionId);
  if (!draft) {
    return NextResponse.json({ error: "対象シーンの本文が見つかりません。先に本文を生成してください。" }, { status: 400 });
  }

  const present = section?.sceneMeta?.presentCharacters ?? [];
  const characters: ReferenceCharacterCard[] = (project.referenceWorks ?? [])
    .flatMap((w) => w.characters ?? [])
    .filter((c) => (present.length ? present.includes(c.name) : true));

  const prompt = buildStoryboardPrompt({
    sceneTitle: section?.title,
    sceneMeta: section?.sceneMeta,
    body: draft.body ?? "",
    characters,
  });

  try {
    const { bytes, mime, model } = await generateStoryboardImage(prompt);
    const ext = mime === "image/webp" ? "webp" : mime === "image/jpeg" ? "jpg" : "png";
    const path = `storyboards/${project.id}/${sectionId}-${Date.now()}.${ext}`;
    const { url } = await put(path, bytes, { access: "public", contentType: mime });
    const storyboard = { url, prompt, model, generatedAt: new Date().toISOString() };
    return NextResponse.json(storyboard, { status: 200 });
  } catch (e) {
    if (e instanceof ImageGenConfigError) {
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[generate-storyboard] error", msg);
    return NextResponse.json({ error: `絵コンテ生成に失敗しました：${msg}` }, { status: 500 });
  }
}
```

> **注記:** `project.referenceWorks` の正確なプロパティ名を実装時に `types.ts` の `Project` で確認し、異なる場合は合わせる（`referenceWorks` を想定）。`Section.id === SectionDraft.sectionId` の対応も確認する。

- [ ] **Step 3: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし。

- [ ] **Step 4: ビルド**

Run: `npx next build`
Expected: 成功（`/api/generate-storyboard` がルート一覧に出る）。

- [ ] **Step 5: コミット**

```bash
git add package.json package-lock.json src/app/api/generate-storyboard/route.ts
git -c user.name="Will" -c user.email="tachiiri@westernavenu.com" commit -m "feat: /api/generate-storyboard（プロンプト構築→生成→Blob保存）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: クライアント連携と writer UI

**Files:**
- Create: `src/lib/storyboardClient.ts`
- Modify: `src/app/writer/page.tsx`（脚本モードのシーン表示に絵コンテUIを追加）

**Interfaces:**
- Consumes: `saveSectionStoryboard`（Task 3）, 型 `Storyboard`, `Project`。
- Produces:
  ```ts
  export async function requestStoryboard(
    project: Project, chapterId: string, sectionId: string
  ): Promise<Storyboard>;
  ```

- [ ] **Step 1: クライアント関数を作成**

`src/lib/storyboardClient.ts`:
```ts
import type { Project, Storyboard } from "@/lib/types";

export async function requestStoryboard(
  project: Project,
  chapterId: string,
  sectionId: string,
): Promise<Storyboard> {
  const res = await fetch("/api/generate-storyboard", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project, chapterId, sectionId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? "絵コンテ生成に失敗しました。");
  return data as Storyboard;
}
```

- [ ] **Step 2: writer に絵コンテUIを追加**

`src/app/writer/page.tsx` の**脚本モードの各シーン（SectionDraft）描画箇所**に、既存の「再生成／編集」ボタン群と同じ並びで絵コンテ用UIを追加する。挿入する要素:

- 状態: `const [sbBusy, setSbBusy] = useState<string | null>(null);`（生成中の sectionId）と `const [sbError, setSbError] = useState<Record<string, string>>({});`
- ハンドラ:
```tsx
async function handleStoryboard(chapterId: string, sectionId: string) {
  setSbBusy(sectionId);
  setSbError((m) => ({ ...m, [sectionId]: "" }));
  try {
    const sb = await requestStoryboard(project, chapterId, sectionId);
    const next = saveSectionStoryboard(chapterId, sectionId, sb);
    setProject(next); // 既存の再読み込み/状態更新に合わせる（updateProject の戻り値を反映）
  } catch (e) {
    setSbError((m) => ({ ...m, [sectionId]: e instanceof Error ? e.message : String(e) }));
  } finally {
    setSbBusy(null);
  }
}
```
- 各シーンの JSX（`draft` が対象 SectionDraft）:
```tsx
<div className="storyboard">
  <button onClick={() => handleStoryboard(draft.chapterId, draft.sectionId)} disabled={sbBusy === draft.sectionId}>
    {sbBusy === draft.sectionId ? "生成中…" : draft.storyboard ? "絵コンテを再生成" : "絵コンテ生成"}
  </button>
  {sbError[draft.sectionId] ? <p className="error">{sbError[draft.sectionId]}</p> : null}
  {draft.storyboard ? (
    <a href={draft.storyboard.url} target="_blank" rel="noreferrer">
      <img src={draft.storyboard.url} alt="絵コンテ" style={{ maxWidth: 320, borderRadius: 8 }} />
    </a>
  ) : null}
</div>
```
- import 追加: `requestStoryboard` from `@/lib/storyboardClient`、`saveSectionStoryboard` from `@/lib/storage`。
- **脚本モード以外では出さない**（既存の `genre === "screenplay"` 分岐内に置く）。`setProject` は writer が既に使っている状態更新関数に合わせる（無ければ既存の再ロード手段に合わせる）。

- [ ] **Step 3: 型チェック＋ビルド**

Run:
```bash
npx tsc --noEmit && npx next build
```
Expected: 双方成功。

- [ ] **Step 4: 実ブラウザ検証（過去メモの教訓：この種の生成は実ブラウザで確認）**

`.env.local` に `GOOGLE_API_KEY` と `BLOB_READ_WRITE_TOKEN` を設定して dev server を起動（`preview_start`）。脚本プロジェクトのシーンで:
- 「絵コンテ生成」→ 数秒でサムネ表示、リロード後も残る、再生成で差し替わる、キー未設定時は明確なエラー。
- `read_console_messages` / `preview_logs` でエラーが無いこと。スクリーンショットを取得。

- [ ] **Step 5: コミット**

```bash
git add src/lib/storyboardClient.ts src/app/writer/page.tsx
git -c user.name="Will" -c user.email="tachiiri@westernavenu.com" commit -m "feat: writer に絵コンテ生成UI（脚本モード）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage:**
- データモデル（Storyboard/SectionDraft.storyboard）→ Task 3 ✓
- プロンプト構築（純関数・②一貫性・ガード）→ Task 2 ✓
- 画像生成分離層（Nano Banana）→ Task 4 ✓
- APIルート＋Blob保存 → Task 5 ✓
- writer UI（生成/サムネ/再生成/失敗表示・脚本専用）→ Task 6 ✓
- テスト（純関数ユニット＋実ブラウザ）→ Task 1/2/4 と Task 6 Step 4 ✓
- env（GOOGLE_API_KEY / BLOB_READ_WRITE_TOKEN / GEMINI_IMAGE_MODEL）→ Global Constraints・Task 4/5/6 ✓
- スコープ外（参照画像/一括/動画/複数カット）→ 計画に含めない ✓
- 設計との差分: 絵コンテの host 型を `Section` → `SectionDraft` に確定（本文と同居・既存パターン準拠）。仕様の骨子は不変。

**2. Placeholder scan:** 「適切なエラー処理」等の曖昧表現なし。各コード手順に実コードを記載。実装時に確認すべき2点（responseModalities のフォールバック、referenceWorks/Section.id の実プロパティ名）は「未確定の穴」ではなく実キー/実型での確認事項として注記済み。

**3. Type consistency:** `buildStoryboardPrompt(input: StoryboardPromptInput)`、`generateStoryboardImage(prompt): {bytes,mime,model}`、`extractInlineImage(json): {bytes,mime}`、`saveSectionStoryboard(chapterId, sectionId, storyboard): Project`、`requestStoryboard(project, chapterId, sectionId): Promise<Storyboard>`、`Storyboard = {url,prompt,model,generatedAt}` — タスク間で一貫。
