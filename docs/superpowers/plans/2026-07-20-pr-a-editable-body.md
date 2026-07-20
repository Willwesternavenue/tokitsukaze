# PR-A: 本文の手動編集（土台） — 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 生成された本文を全ジャンルで手動編集できるようにする（現状は翻訳モード限定）。手動編集は初回のみ自動保護し、旧版は履歴に退避、翻訳フローは壊さない。

**Architecture:** 既存の翻訳用編集フロー（`editingBody`/`bodyDraft`/`handleStartEditBody`/`handleSaveBody`）を全ジャンルに開放。保存は新storage関数 `saveManualBodyEdit`（履歴退避＋連続編集の圧縮＋`bodyEditedAt`更新＋初回のみ自動ロック）に集約。`editingBody: boolean` を `editingTarget: null | "body"` に置換。`SectionDraft` に `bodyEditedAt` / `lockReason` を追加。

**Tech Stack:** Next.js 14 App Router / TypeScript / localStorage / 既存 `diffLines`・`diffStats`（`src/lib/diff.ts`）。

## Global Constraints

- **テストランナーは無い**。検証は `npx tsc --noEmit`、`npx next build`、ブラウザ実機、純粋ロジックは scratchpad の node スクリプト。
- **tsc/build は Node 24**: 各コマンド前に `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24.15.0 >/dev/null`。build 成功＝`✓ Generating static pages`（`unpdf` warning は既存・無視）。
- **コミット**: `git -c user.name="Will" -c user.email="tachiiri@westernavenu.com" commit`、本文末尾 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。scratchpad スクリプトはコミットしない。
- **決定（設計書より）**: Q2=A（手動編集は**初回のみ**自動保護。`bodyEditedAt` が未設定かつ未ロックのときだけ `locked=true`/`lockReason="manual"`。以降の編集や、ユーザーが解除した後の再編集では自動ロックしない）。旧版は `bodyHistory`（最大10版）へ。**連続手動編集はまとめる**（直近履歴が「手動編集前」かつ5分以内なら積み増さない）。**翻訳モードの対訳/再翻訳/一括翻訳/訳文編集は挙動を変えない**。
- `replaceDraftBody`（既存）は /terms の一括置換でも使われる。**それは変更せず**、手動編集用に別関数 `saveManualBodyEdit` を新設する（一括置換は自動ロックさせない）。

---

## Task 1: `SectionDraft` に `bodyEditedAt` / `lockReason` を追加

**Files:**
- Modify: `src/lib/types.ts`（`SectionDraft` 型、`locked` の直後）

**Interfaces:**
- Produces: `SectionDraft.bodyEditedAt?: string`、`SectionDraft.lockReason?: "user" | "manual"`。Task 2・3・4 が参照。

- [ ] **Step 1: 型を追加**

`src/lib/types.ts` の `SectionDraft` の `locked?: boolean;` の直後に2行足す:

```ts
  /** 波及再生成から保護するフラグ（本文を手で直した節） */
  locked?: boolean;
  /** ロックの由来。手動編集の自動保護="manual"、ユーザーが明示的に掛けた="user" */
  lockReason?: "user" | "manual";
  /** 最後に本文を手動編集した時刻（ISO）。「手動編集済み」バッジと自動ロック判定に使う */
  bodyEditedAt?: string;
  /** 翻訳書モード: 過去の訳文（再生成・手動編集の前に退避。Diff比較の材料。最大10版） */
  bodyHistory?: BodyVersion[];
```

- [ ] **Step 2: 型チェック**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24.15.0 >/dev/null; npx tsc --noEmit`
Expected: エラーなし。

- [ ] **Step 3: コミット**

```bash
git add src/lib/types.ts
git -c user.name="Will" -c user.email="tachiiri@westernavenu.com" commit -m "$(printf 'feat: SectionDraft に bodyEditedAt / lockReason を追加（本文編集の土台）\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 2: storage に `saveManualBodyEdit` と `setSectionLocked` の reason 対応

**Files:**
- Modify: `src/lib/storage.ts`（`setSectionLocked`：446行付近、`replaceDraftBody` の近くに新関数）

**Interfaces:**
- Consumes: `SectionDraft.bodyEditedAt`/`lockReason`（Task 1）。
- Produces:
  - `saveManualBodyEdit(chapterId: string, sectionId: string, newBody: string): Project`
  - `setSectionLocked(chapterId, sectionId, locked: boolean, reason?: "user" | "manual"): Project`（第4引数追加、既定 "user"）

- [ ] **Step 1: 純粋ロジックの scratchpad サニティ**

自動ロック判定と履歴圧縮の芯を確認。scratchpad に `pr-a.mjs`:

```js
const COALESCE = 5*60*1000;
function decide(d, newBody, now){
  if (d.body === newBody) return d;
  const hist = d.bodyHistory ?? [];
  const last = hist[hist.length-1];
  const coalesce = !!last && last.note==="手動編集前" && (now - Date.parse(last.savedAt) < COALESCE);
  const bodyHistory = coalesce ? hist : [...hist, {savedAt:d.updatedAt, body:d.body, note:"手動編集前"}].slice(-10);
  const firstEdit = !d.bodyEditedAt;
  const autoLock = firstEdit && !d.locked;
  return { ...d, body:newBody, bodyHistory, bodyEditedAt:new Date(now).toISOString(),
           ...(autoLock ? {locked:true, lockReason:"manual"} : {}), updatedAt:new Date(now).toISOString() };
}
const t0 = Date.parse("2026-07-20T00:00:00Z");
// 初回編集: 自動ロック + AI版を履歴に退避
let d = { body:"AI原文", updatedAt:"2026-07-20T00:00:00Z" };
d = decide(d, "手直し1", t0+1000);
console.log("初回:", {locked:d.locked, lockReason:d.lockReason, hist:d.bodyHistory.map(h=>h.body), edited:!!d.bodyEditedAt});
// 直後の再編集(5分以内): 履歴は積み増さない(AI原文を温存)、ロックは既にtrueのまま
d = decide(d, "手直し2", t0+2000);
console.log("連続:", {hist:d.bodyHistory.map(h=>h.body)});
// ユーザーが解除 → 再編集: 再ロックしない
d = { ...d, locked:false, lockReason:undefined };
d = decide(d, "手直し3", t0+3000);
console.log("解除後:", {locked:d.locked, lockReason:d.lockReason});
```

- [ ] **Step 2: サニティ実行**

Run: `node "$TMPDIR/pr-a.mjs"`（または scratchpad 絶対パス）
Expected: `初回` locked=true/lockReason=manual/hist=["AI原文"]、`連続` hist=["AI原文"]（積み増さない）、`解除後` locked=false（再ロックしない）。

- [ ] **Step 3: `setSectionLocked` に reason を追加**

`src/lib/storage.ts` の `setSectionLocked` を次に置換:

```ts
export function setSectionLocked(
  chapterId: string,
  sectionId: string,
  locked: boolean,
  reason: "user" | "manual" = "user",
): Project {
  return updateProject((p) => ({
    ...p,
    generatedSections: p.generatedSections.map((d) =>
      d.chapterId === chapterId && d.sectionId === sectionId
        ? { ...d, locked, lockReason: locked ? reason : undefined }
        : d,
    ),
  }));
}
```

- [ ] **Step 4: `saveManualBodyEdit` を追加**

`replaceDraftBody` の直後に新関数を追加（`replaceDraftBody` 本体は変更しない）:

```ts
/**
 * 本文の手動編集を保存する（全ジャンル共通）。
 * - 旧本文を bodyHistory に退避（最大10版）。ただし直近が「手動編集前」かつ5分以内なら
 *   積み増さずまとめる（連続手動編集で AI 生成版が履歴から押し出されるのを防ぐ）。
 * - bodyEditedAt を更新。
 * - 初回手動編集のみ自動保護（bodyEditedAt 未設定＝初回、かつ未ロックのとき locked=true/lockReason="manual"）。
 *   ユーザーが解除した後（bodyEditedAt 済・未ロック）の再編集では自動ロックしない。
 */
export function saveManualBodyEdit(
  chapterId: string,
  sectionId: string,
  newBody: string,
): Project {
  const HISTORY_COALESCE_MS = 5 * 60 * 1000;
  const nowIso = new Date().toISOString();
  return updateProject((p) => ({
    ...p,
    generatedSections: p.generatedSections.map((d) => {
      if (d.chapterId !== chapterId || d.sectionId !== sectionId) return d;
      if (d.body === newBody) return d;
      const hist = d.bodyHistory ?? [];
      const last = hist[hist.length - 1];
      const coalesce =
        !!last &&
        last.note === "手動編集前" &&
        Date.now() - Date.parse(last.savedAt) < HISTORY_COALESCE_MS;
      const bodyHistory = coalesce
        ? hist
        : [...hist, { savedAt: d.updatedAt, body: d.body, note: "手動編集前" }].slice(-10);
      const autoLock = !d.bodyEditedAt && !d.locked;
      return {
        ...d,
        body: newBody,
        bodyHistory,
        bodyEditedAt: nowIso,
        ...(autoLock ? { locked: true, lockReason: "manual" as const } : {}),
        updatedAt: nowIso,
      };
    }),
  }));
}
```

- [ ] **Step 5: 型チェック＋ビルド**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24.15.0 >/dev/null; npx tsc --noEmit && npx next build 2>&1 | grep -iE "Failed|error:|✓ Generating"`
Expected: tsc エラーなし・build 成功。

- [ ] **Step 6: コミット**

```bash
git add src/lib/storage.ts
git -c user.name="Will" -c user.email="tachiiri@westernavenu.com" commit -m "$(printf 'feat: saveManualBodyEdit（履歴圧縮＋初回のみ自動保護）と setSectionLocked の reason 対応\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 3: 本文編集を全ジャンルに開放（state 置換・ボタン・textarea・保存）

**Files:**
- Modify: `src/app/writer/page.tsx`

**Interfaces:**
- Consumes: `saveManualBodyEdit`（Task 2）。
- Produces: 全ジャンルで本文を textarea 編集→保存できる。state は `editingTarget: "body" | null`。

- [ ] **Step 1: import と state を置換**

`src/app/writer/page.tsx` の import に `saveManualBodyEdit` を追加（`replaceDraftBody` の行の近く）。state（84行付近）を置換:

```tsx
  const [editingTarget, setEditingTarget] = useState<"body" | null>(null);
  const [bodyDraft, setBodyDraft] = useState("");
```

（`const [editingBody, setEditingBody] = useState(false);` を上記の `editingTarget` 行に置き換える。）

- [ ] **Step 2: `editingBody` の参照を全て `editingTarget` に置換**

以下を機械的に置換（`grep -n editingBody src/app/writer/page.tsx` で全箇所確認）:
- `setEditingBody(false)` → `setEditingTarget(null)`（146行, 633行, 1155行付近）
- `setEditingBody(true)` → `setEditingTarget("body")`（620行付近）
- `!editingBody`（956行付近）→ `editingTarget !== "body"`
- `editingBody ?`（1143行付近）→ `editingTarget === "body" ?`

- [ ] **Step 3: `handleSaveBody` を `saveManualBodyEdit` に付け替え**

`handleSaveBody`（624行付近）を置換:

```tsx
  function handleSaveBody() {
    if (!selected || !currentDraft) return;
    const next = saveManualBodyEdit(selected.chapter.id, selected.section.id, bodyDraft);
    setProject(next);
    setEditingTarget(null);
    syncSelectedFrom(next, selected.chapter.id, selected.section.id);
  }
```

- [ ] **Step 4: 「本文を編集」ボタンを全ジャンルに開放**

956行付近のボタン条件を変更（`isTranslation &&` を外し、ラベルをジャンルで出し分け）:

```tsx
                    {currentDraft && editingTarget !== "body" ? (
                      <button className="btn" onClick={handleStartEditBody} type="button">
                        {isTranslation ? "訳文を編集" : "本文を編集"}
                      </button>
                    ) : null}
```

- [ ] **Step 5: 非翻訳の本文表示に編集 textarea を追加**

1226〜1227行の非翻訳ブランチ（読み取り専用 div）を置換:

```tsx
                  ) : editingTarget === "body" ? (
                    <>
                      <textarea
                        className="input mono"
                        rows={18}
                        value={bodyDraft}
                        onChange={(e) => setBodyDraft(e.target.value)}
                      />
                      <div className="flex" style={{ marginTop: 8, gap: 8 }}>
                        <button className="btn primary" type="button" onClick={handleSaveBody}>
                          保存（旧版を退避）
                        </button>
                        <button className="btn" type="button" onClick={() => setEditingTarget(null)}>
                          キャンセル
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="draft-body">{currentDraft.body || "（本文が空です）"}</div>
                  )}
```

- [ ] **Step 6: 型チェック＋ビルド**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24.15.0 >/dev/null; npx tsc --noEmit && npx next build 2>&1 | grep -iE "Failed|error:|✓ Generating"`
Expected: tsc エラーなし・build 成功。`editingBody` の未置換参照が残っていれば tsc が落ちるので、全部置換されたことの確認になる。

- [ ] **Step 7: コミット**

```bash
git add src/app/writer/page.tsx
git -c user.name="Will" -c user.email="tachiiri@westernavenu.com" commit -m "$(printf 'feat: 本文の手動編集を全ジャンルに開放（editingTarget化・編集ボタン・textarea・saveManualBodyEdit保存）\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 4: 安全挙動（手動編集バッジ・単体再生成の確認）

**Files:**
- Modify: `src/app/writer/page.tsx`

**Interfaces:**
- Consumes: `currentDraft.bodyEditedAt`/`lockReason`。

- [ ] **Step 1: 「手動編集済み（保護中）」バッジを本文ヘッダに表示**

節タイトル（923行付近 `<h2 ...>{selected.section.title}</h2>`）の直後に、手動編集済みバッジを足す:

```tsx
                    <h2 style={{ fontSize: 15, marginTop: 2 }}>{selected.section.title}</h2>
                    {currentDraft?.bodyEditedAt ? (
                      <span className="badge warn" style={{ fontSize: 10, marginTop: 4, display: "inline-block" }}>
                        手動編集済み{currentDraft.locked && currentDraft.lockReason === "manual" ? "（保護中）" : ""}
                      </span>
                    ) : null}
```

- [ ] **Step 2: 単体「本文を再生成」で手動編集が消える前に確認**

`handleGenerate`（252行付近）の冒頭、`setLoading(true)` の前に確認を入れる:

```tsx
  async function handleGenerate(force = false) {
    if (!project || !selected) return;
    // 手動編集して保護中の節を再生成すると編集が失われるため確認する
    if (
      force &&
      currentDraft?.bodyEditedAt &&
      currentDraft.locked &&
      currentDraft.lockReason === "manual" &&
      !confirm("この節は手動編集され保護中です。再生成すると手動編集が失われます（旧版は変更差分から復元できます）。再生成しますか？")
    ) {
      return;
    }
    setError(null);
    setLoading(true);
    // ...既存のまま...
```

- [ ] **Step 3: 型チェック＋ビルド**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24.15.0 >/dev/null; npx tsc --noEmit && npx next build 2>&1 | grep -iE "Failed|error:|✓ Generating"`
Expected: tsc エラーなし・build 成功。

- [ ] **Step 4: コミット**

```bash
git add src/app/writer/page.tsx
git -c user.name="Will" -c user.email="tachiiri@westernavenu.com" commit -m "$(printf 'feat: 手動編集バッジと、保護中の節の単体再生成に確認ダイアログ\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 5: 未保存のまま節切替の確認 ＋ 非翻訳の差分表示

**Files:**
- Modify: `src/app/writer/page.tsx`

- [ ] **Step 1: 未保存ガード付きの節選択ハンドラ**

`handleGenerate` の近く（関数定義エリア）に追加:

```tsx
  function handleSelectSection(chapter: Chapter, section: Section) {
    if (
      editingTarget === "body" &&
      currentDraft &&
      bodyDraft !== currentDraft.body &&
      !confirm("未保存の編集があります。破棄して移動しますか？")
    ) {
      return;
    }
    setEditingTarget(null);
    setSelected({ chapter, section });
  }
```

- [ ] **Step 2: 左ツリーのクリックを差し替え**

886行付近 `onClick={() => setSelected({ chapter: c, section: s })}` を:

```tsx
                          onClick={() => handleSelectSection(c, s)}
```

- [ ] **Step 3: 非翻訳に「変更差分」トグルを追加**

非翻訳ブランチ（Task 3 Step 5 で編集した領域）の読み取り専用 div のときに、`bodyHistory` があれば差分トグルを出す。読み取り専用 div を次に置換:

```tsx
                  ) : (
                    <>
                      {currentDraft.bodyHistory?.length ? (
                        <button
                          className="btn sm"
                          type="button"
                          onClick={() => setShowBodyDiff((v) => !v)}
                          style={{ marginBottom: 8 }}
                        >
                          {showBodyDiff ? "本文に戻す" : `変更差分（${currentDraft.bodyHistory.length}版）`}
                        </button>
                      ) : null}
                      {showBodyDiff && currentDraft.bodyHistory?.length ? (
                        (() => {
                          const base = currentDraft.bodyHistory[currentDraft.bodyHistory.length - 1];
                          const lines = diffLines(base.body, currentDraft.body);
                          const stats = diffStats(lines);
                          return (
                            <div className="draft-body">
                              <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>
                                {base.note}（{base.savedAt.slice(0, 16).replace("T", " ")}）との差分　+{stats.added} / -{stats.removed}
                              </div>
                              {lines.map((ln, i) => (
                                <div key={i} className={`diff-line ${ln.type}`}>{ln.text || " "}</div>
                              ))}
                            </div>
                          );
                        })()
                      ) : (
                        <div className="draft-body">{currentDraft.body || "（本文が空です）"}</div>
                      )}
                    </>
                  )}
```

`diffLines`/`diffStats` は翻訳ブランチで既に import 済み。`diff-line` の CSS クラスは翻訳の差分表示で既に使われている（`src/app/globals.css`）。新規 state を追加（Task 3 の state 近く）:

```tsx
  const [showBodyDiff, setShowBodyDiff] = useState(false);
```

節を切り替えたら差分表示は畳む。`handleSelectSection` の `setEditingTarget(null)` の隣に `setShowBodyDiff(false);` を足す。

- [ ] **Step 4: 型チェック＋ビルド**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24.15.0 >/dev/null; npx tsc --noEmit && npx next build 2>&1 | grep -iE "Failed|error:|✓ Generating"`
Expected: tsc エラーなし・build 成功。

- [ ] **Step 5: コミット**

```bash
git add src/app/writer/page.tsx
git -c user.name="Will" -c user.email="tachiiri@westernavenu.com" commit -m "$(printf 'feat: 未保存のまま節切替の確認と、非翻訳の変更差分トグル\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 6: リグレッション検証（コントローラ／ブラウザ）

**Files:** 変更なし（検証のみ。不具合は該当 Task に戻す）。

- [ ] **Step 1: 非翻訳の編集フロー**（論文プロジェクト）
  - 本文生成済みの節で「本文を編集」→textarea 編集→「保存」→本文が更新される。
  - 保存後、節タイトル脇に「手動編集済み（保護中）」バッジが出る。
  - localStorage で当該 `SectionDraft` に `bodyEditedAt` があり `locked===true`・`lockReason==="manual"`、`bodyHistory` に旧版（note "手動編集前"）がある。
- [ ] **Step 2: 自動ロックと解除の記憶**
  - 保護中の節で「保護」を外す（波及パネルのロック解除、または該当UI）→ `locked=false`・`lockReason` クリア。
  - もう一度編集→保存しても**再ロックされない**（`locked` は false のまま、`bodyEditedAt` は更新）。
- [ ] **Step 3: 履歴圧縮**
  - 同じ節を短時間に2〜3回編集保存→`bodyHistory` の「手動編集前」が積み増されず、最初の AI 版が保持されている。
- [ ] **Step 4: 単体再生成の確認**
  - 保護中（手動編集）の節で「本文を再生成」→確認ダイアログが出る。キャンセルで再生成されない。
- [ ] **Step 5: 未保存切替**
  - 編集中（未保存）に左ツリーで別節をクリック→確認ダイアログ。キャンセルで留まる。破棄で移動し編集は捨てられる。
- [ ] **Step 6: 非翻訳の差分**
  - 編集済み節で「変更差分」トグル→旧版との差分が表示され、「本文に戻す」で本文表示へ。
- [ ] **Step 7: 翻訳モードのリグレッション**（翻訳プロジェクトに切替）
  - 対訳/訳文/変更差分タブが従来通り。訳文編集→タブ切替→戻って保存で正しく訳文が保存される。再翻訳・一括翻訳が従来通り。
- [ ] **Step 8: console エラーが無いこと**（`read_console_messages` onlyErrors）。検証で見つけた不具合は該当 Task に戻して修正・再検証。

---

## Self-Review（スペック突合）

- **SectionDraft.bodyEditedAt / lockReason**（spec P1）→ Task 1 ✅
- **editingBody→editingTarget**（spec P2）→ Task 3 ✅
- **本文編集を全ジャンルに開放**（spec PR-A）→ Task 3 ✅
- **初回のみ自動保護・解除の記憶**（spec Q2=A・P1）→ Task 2（判定）＋ Task 4（バッジ）＋ Task 6 Step 2（検証）✅
- **bodyHistory 圧縮**（spec P3）→ Task 2 ✅
- **未保存のまま節切替の確認**（spec P2）→ Task 5 ✅
- **単体再生成でロック節の扱い**（spec 実装時確認点）→ Task 4（確認ダイアログ）✅
- **非翻訳の差分ビュー**（spec PR-A）→ Task 5 ✅
- **翻訳フロー不変**（spec 最重要リグレッション）→ Task 6 Step 7 ✅
- `replaceDraftBody` を壊さず別関数（/terms 一括置換は自動ロックさせない）→ Task 2 で `saveManualBodyEdit` を新設 ✅

Placeholder スキャン: 曖昧語なし・全コードブロック実体あり。型整合: `editingTarget: "body" | null`、`saveManualBodyEdit(chapterId, sectionId, newBody)`、`setSectionLocked(…, reason?)`、`showBodyDiff` は各 Task 間で一致。
