# PR-B1: 節への文献紐付け → 生成反映 — 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 論文モードで、各節に「使う文献」を紐付け、その節の本文生成時に紐付け文献を優先引用としてプロンプトに注入する（HINT型）。

**Architecture:** `Section.referenceIds?: string[]`（構成の節にIDを持たせる。本体は既存 `project.references`）を追加。`/writer` にチェックリストUIを足し `updateSectionInOutline` で保存。`buildPaperContext(project, section?)` に節を渡し、紐付け文献を「この節で優先的に引用」ブロックとして system prompt に足す。存在しないID（孤児）は表示・生成の両方で `project.references` と突合してフィルタ。

**Tech Stack:** Next.js 14 App Router / TypeScript / localStorage 永続 / Vercel Workflow（生成）。

## Global Constraints

- **テストランナーは無い**。検証は `npx tsc --noEmit`、`npx next build`、ブラウザ実機、純粋ロジックは scratchpad の node スクリプトで行う（このリポジトリの既定運用）。
- **ビルド/型チェックは Node 24 で実行**: 各コマンドの前に `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24.15.0` を前置（v18 だと `next build` が落ちる）。
- **コミット**: `git -c user.name="Will" -c user.email="tachiiri@westernavenu.com" commit`。本文末尾に `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。
- **スコープは paper のみ**（生成反映は `buildPaperContext` だけ。business/news は非スコープ）。**HINT型**（紐付けを優先するが他の登録文献の引用は禁止しない）。
- 参照本体は `project.references`（`Reference = { id, title, author?, source?, year?, url?, notes? }`）。マーカー生成は `src/lib/citation.ts` の `authorYearMarker(ref)`。

---

## Task 1: `Section` 型に `referenceIds` を追加

**Files:**
- Modify: `src/lib/types.ts`（`Section` 型、先頭付近）

**Interfaces:**
- Produces: `Section.referenceIds?: string[]`（Task 2・Task 3 が参照）。

- [ ] **Step 1: 型を追加**

`src/lib/types.ts` の `Section` を次にする（`sourceText` の下に1行足すだけ）:

```ts
export type Section = {
  id: string;
  title: string;
  summary?: string;
  /** 脚本モード: シーンの slugline・尺・目的 (他ジャンルでは undefined) */
  sceneMeta?: SceneMeta;
  /** 翻訳書モード: このセグメントの原文 (他ジャンルでは undefined) */
  sourceText?: string;
  /** 論文モード: この節で優先的に引用する文献ID（本体は project.references）。未設定=紐付けなし */
  referenceIds?: string[];
};
```

- [ ] **Step 2: 型チェック**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24.15.0 >/dev/null; npx tsc --noEmit`
Expected: エラーなし（optional 追加なので既存は影響なし）。

- [ ] **Step 3: コミット**

```bash
git add src/lib/types.ts
git -c user.name="Will" -c user.email="tachiiri@westernavenu.com" commit -m "$(printf 'feat: Section.referenceIds を追加（節への文献紐付けの器）\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 2: `buildPaperContext(project, section?)` に優先引用ブロックを注入

**Files:**
- Modify: `src/workflows/draft.ts`（`buildPaperContext` の定義：459行付近、呼び出し：214行付近）

**Interfaces:**
- Consumes: `Section.referenceIds`（Task 1）、`project.references`、`authorYearMarker`（既存 import）。
- Produces: `buildPaperContext(project: Project, section?: Section): string`。

- [ ] **Step 1: 注入ロジックの純粋サニティ（scratchpad）**

孤児フィルタと優先ブロック生成の芯だけを移植して確認する。scratchpad に `pr-b1.mjs` を作成:

```js
const refs = [
  { id: "r1", title: "Attention", author: "Vaswani", year: "2017" },
  { id: "r2", title: "深層学習と教育", author: "山田太郎", year: "2020" },
];
function shortAuthor(r){const a=(r.author||"").trim();return a?a.split(/[,、;；・&]| and /)[0].trim():r.title.trim();}
function aym(r){const y=(r.year||"").trim();return y?`〔${shortAuthor(r)}, ${y}〕`:`〔${shortAuthor(r)}〕`;}
// 節に r2 と 孤児 rX を紐付け → 存在する r2 だけ拾う
function priorityBlock(refs, referenceIds){
  const set = new Set(referenceIds||[]);
  const picked = refs.filter(r => set.has(r.id)); // 孤児(rX)は project.references に無いので自然に除外
  if(!picked.length) return "";
  return "## この節で優先的に引用する文献（紐付け済み。該当箇所で必ず引用マーカーを使う）\n" +
    picked.map(r=>`- ${r.title} 【引用マーカー】${aym(r)}`).join("\n");
}
console.log("picked r2 + orphan rX:\n" + priorityBlock(refs, ["r2","rX"]));
console.log("empty:", JSON.stringify(priorityBlock(refs, [])));
console.log("undefined:", JSON.stringify(priorityBlock(refs, undefined)));
```

- [ ] **Step 2: サニティ実行**

Run: `node "$TMPDIR/pr-b1.mjs"` （または scratchpad の絶対パス）
Expected: r2 の行だけが出て孤児 rX は出ない。empty/undefined は空文字。

- [ ] **Step 3: `buildPaperContext` を実装**

`src/workflows/draft.ts` の定義を次に変更（シグネチャに `section?: Section` を追加し、`terms` 注入の直前あたり＝`【守るべきこと】` を push する前に優先ブロックを差し込む）:

```ts
function buildPaperContext(project: Project, section?: Section): string {
  const m = project.paperMeta;
  const refs = project.references ?? [];
  // ...（既存の論文仕様・参考文献リスト生成はそのまま）...

  // 節に紐付いた文献を「この節で優先的に引用」として明示（HINT型）。
  // 孤児ID（project.references に無いID）は突合で自然に除外される。
  const linkedIds = new Set(section?.referenceIds ?? []);
  const linked = refs.filter((r) => linkedIds.has(r.id));
  if (linked.length > 0) {
    parts.push(
      "## この節で優先的に引用する文献（この節に紐付け済み。該当する主張ではこれらの【引用マーカー】を優先して使う。ただし他の登録文献の引用も禁止しない）",
    );
    parts.push(linked.map((r) => `- ${r.title}${r.author ? ` / ${r.author}` : ""} 【引用マーカー】${authorYearMarker(r)}`).join("\n"));
  }

  // ...（既存の 用語集・【守るべきこと】push はそのまま）...
  return parts.join("\n\n");
}
```

（挿入位置は「用語集」push の直前でよい。既存行は消さず、上記ブロックを足すだけ。）

- [ ] **Step 4: 呼び出し側に section を渡す**

`src/workflows/draft.ts` の呼び出し（214行付近）を変更:

```ts
                : project.genre === "paper"
                  ? buildPaperContext(project, section)
                  : "";
```

（`section` は draftStep の引数として同スコープに存在する。）

- [ ] **Step 5: 型チェック＋ビルド**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24.15.0 >/dev/null; npx tsc --noEmit && npx next build 2>&1 | grep -iE "Failed|error:|✓ Generating"`
Expected: tsc エラーなし。build は `✓ Generating static pages` が出る（`unpdf` の既存 warning は無視）。

- [ ] **Step 6: コミット**

```bash
git add src/workflows/draft.ts
git -c user.name="Will" -c user.email="tachiiri@westernavenu.com" commit -m "$(printf 'feat: 論文の本文生成に節の紐付け文献を優先引用として注入（HINT型・孤児IDは突合で除外）\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 3: `/writer` に「この節で使う文献」チェックリスト

**Files:**
- Modify: `src/app/writer/page.tsx`（小見出し編集パネル内、`handleEditHeading` の近くに保存ハンドラと UI を追加）

**Interfaces:**
- Consumes: `project.references`、`selected.section.referenceIds`、`updateSectionInOutline`（既存 import）。
- Produces: 節選択中に紐付けを編集できるUI（保存は `updateSectionInOutline(chapterId, sectionId, { referenceIds })`）。

- [ ] **Step 1: 保存ハンドラを追加**

`src/app/writer/page.tsx` の `handleEditHeading` の直後に追加:

```tsx
  // 論文モード: この節に使う文献の紐付けをトグルする
  function handleToggleSectionReference(refId: string, checked: boolean) {
    if (!selected) return;
    const current = selected.section.referenceIds ?? [];
    const nextIds = checked
      ? Array.from(new Set([...current, refId]))
      : current.filter((id) => id !== refId);
    const next = updateSectionInOutline(selected.chapter.id, selected.section.id, {
      referenceIds: nextIds,
    });
    setProject(next);
    syncSelectedFrom(next, selected.chapter.id, selected.section.id);
  }
```

- [ ] **Step 2: チェックリストUIを追加**

小見出し編集パネル（`editingHeading` ブロック）内、削除ボタンの後・波及確認の前あたりに、論文かつ文献が登録済みのときだけ表示する:

```tsx
                    {project.genre === "paper" && (project.references?.length ?? 0) > 0 ? (
                      <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed var(--border)" }}>
                        <div className="field-label">この節で使う文献（優先的に引用されます）</div>
                        <ul className="list-block" style={{ border: "1px solid var(--border)", borderRadius: 3 }}>
                          {project.references.map((r) => {
                            const checked = (selected.section.referenceIds ?? []).includes(r.id);
                            return (
                              <li key={r.id}>
                                <label className="staff-toggle" style={{ gap: 8 }}>
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={(e) => handleToggleSectionReference(r.id, e.target.checked)}
                                  />
                                  <span style={{ fontSize: 12 }}>
                                    {r.title}
                                    {r.author ? <span className="muted">（{r.author}{r.year ? ` ${r.year}` : ""}）</span> : null}
                                  </span>
                                </label>
                              </li>
                            );
                          })}
                        </ul>
                        <p className="help" style={{ marginTop: 6 }}>
                          チェックした文献は、この節の本文生成時に「優先的に引用する文献」としてAIへ渡されます。
                          文献の登録・編集は <Link href="/references">参考文献・文献カルテ</Link> で。
                        </p>
                      </div>
                    ) : null}
```

（`Link` は writer で既に import 済みか確認。未 import なら `import Link from "next/link";` を足す。）

- [ ] **Step 3: 孤児の無害化を確認（コード上）**

チェックリストは `project.references` を列挙するので、削除済みID（孤児）はそもそも表示されない＝チェック外しようがない。`section.referenceIds` に孤児が残っても Task 2 の突合で除外される。ここでは追加コード不要（Step 4 のブラウザ検証で確かめる）。

- [ ] **Step 4: 型チェック＋ビルド**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24.15.0 >/dev/null; npx tsc --noEmit && npx next build 2>&1 | grep -iE "Failed|error:|✓ Generating"`
Expected: tsc エラーなし・build 成功。

- [ ] **Step 5: ブラウザ検証（永続と孤児）**

`preview_start`（name: dev）→ 論文プロジェクトで `/writer` を開き、節を選び小見出し編集を開く。
1. 文献をチェック → リロードしてもチェックが残る（`updateSectionInOutline` 保存の確認）。
2. `javascript_tool` で `JSON.parse(localStorage.getItem('kikigaki:projects:v2'))[0].selectedOutline.chapters[..].sections[..].referenceIds` に選んだIDが入っている。
3. `/references` で文献を1件削除 → `/writer` のチェックリストがエラーなく再描画され、その文献が消える（孤児が表示に出ない）。

Expected: 1〜3 すべて成功。console にエラーが出ない（`read_console_messages`）。

- [ ] **Step 6: コミット**

```bash
git add src/app/writer/page.tsx
git -c user.name="Will" -c user.email="tachiiri@westernavenu.com" commit -m "$(printf 'feat: /writer に節ごとの「使う文献」チェックリストを追加（論文モード）\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 4: 送信経路と既存フローのリグレッション検証

**Files:**
- 変更なし（検証のみ）。必要なら発見した不具合を各 Task に戻して修正。

**Interfaces:**
- Consumes: Task 1〜3 の成果。

- [ ] **Step 1: `slimProjectForDraft` が references と section を落とさないことを確認**

`src/lib/translationClient.ts` の `slimProjectForDraft`（非翻訳分岐）を読み、`project.references` が保持されること、`startSectionDraft` が `section` を**別パラメータで**（slim を通さず）送っていることを確認する。コード上、`stripped = { ...project, ... }` で references は上書きされず、`section` は `postJson(..., { project: slim, chapter, section, ... })` で独立送信される。

Run: `grep -n "references\|section," src/lib/translationClient.ts`
Expected: references を落とす行が無い。`section` が postJson 本文に含まれる。

- [ ] **Step 2: 生成プロンプトの実内容を確認（送信ペイロード）**

論文プロジェクトで節に文献を紐付け、`/writer` で「この小見出しの本文を生成」を押す。`read_network_requests`（urlPattern: `generate-draft`）でリクエスト本文を取得し、`section.referenceIds` が含まれ、`project.references` にメタ（著者・年）が残っていることを確認する。
※ローカルにAIキーが無く本文生成自体は失敗し得るが、**送信内容の検証が目的**。実生成の文体反映は本番で確認。

Expected: リクエスト JSON に `section.referenceIds`（選んだID）と `project.references`（本体）の両方がある。

- [ ] **Step 3: 既存フローが壊れていないこと**

`/writer` で次を確認: 小見出しの手動編集（タイトル/概要）→保存が従来通り、削除、AI修正ボタン表示、翻訳プロジェクトに切替えて対訳/訳文タブが従来通り表示される。
Expected: いずれも従来通り。console エラーなし。

- [ ] **Step 4: 検証結果を記録してコミット（あれば）**

コード変更が発生した場合のみコミット。無ければこの Task はコミット無しで完了。ブラウザ検証のスクショ/ネットワーク確認結果を PR 説明に添える。

---

## Self-Review（この計画のスペック突合）

- **Section.referenceIds**（spec PR-B1 データ）→ Task 1 ✅
- **チェックリストUI・updateSectionInOutline 保存**（spec）→ Task 3 ✅
- **buildPaperContext(project, section) シグネチャ変更＋優先注入（HINT）**（spec P5）→ Task 2 ✅
- **孤児 referenceId の表示・生成フィルタ**（spec P6）→ Task 2（生成側突合）＋ Task 3 Step 3/5（表示は列挙で自然除外）✅
- **slim で references 温存の保証／section 独立送信**（spec P5b）→ Task 4 Step 1-2 ✅
- **HINT型・paper 限定**（spec 決定）→ Task 2/3 でガード済み ✅
- 非スコープ（RESTRICT・business/news・同一著者同年）は本計画に含めない ✅

Placeholder スキャン: 「適切に処理」等の曖昧語なし・全コードブロック実体あり。型整合: `referenceIds: string[]`、`handleToggleSectionReference(refId, checked)`、`buildPaperContext(project, section?)` は各 Task 間で一致。
