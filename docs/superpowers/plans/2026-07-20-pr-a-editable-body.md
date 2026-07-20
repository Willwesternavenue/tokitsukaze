# PR-A: 本文の手動編集（土台） — 実装計画（レビュー反映・改訂）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **同じ `src/app/writer/page.tsx` を Task 3〜5 が順に編集するため、行番号ではなく本文中の文字列をアンカーに置換すること（先行 Task の編集で行番号はずれる）。**

**Goal:** 生成された本文を全ジャンルで手動編集できるようにする（現状は翻訳モード限定）。**非翻訳の手動編集のみ**初回に自動保護し、旧版は履歴に退避、**翻訳フローは一切変えない**。

**Architecture:** 既存の翻訳用編集フロー（`editingBody`/`bodyDraft`/`handleStartEditBody`/`handleSaveBody`）を全ジャンルに開放。保存は新storage関数 `saveManualBodyEdit(…, isManualEdit)` に集約（履歴退避＋`bodyEditedAt`更新は常時、**連続編集の圧縮と初回自動ロックは `isManualEdit` のときだけ**）。`handleSaveBody` は `isManualEdit=!isTranslation` を渡す＝**翻訳は自動ロックも履歴圧縮もしない（＝従来の replaceDraftBody と同じ・毎回1版積む）**。`SectionDraft` に `bodyEditedAt` / `lockReason` を追加。`editingBody: boolean` は据え置き（翻訳が編集するのは訳文=`body` の1系統のみのため union 化は不要）。

**Tech Stack:** Next.js 14 App Router / TypeScript / localStorage / 既存 `diffLines`・`diffStats`（`src/lib/diff.ts`）。

## Global Constraints

- **テストランナーは無い**。検証は `npx tsc --noEmit`、`npx next build`、ブラウザ実機、純粋ロジックは scratchpad の node スクリプト。
- **tsc/build は Node 24**: 各コマンド前に `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24.15.0 >/dev/null`。build 成功＝`✓ Generating static pages`（`unpdf` warning は既存・無視）。
- **コミット**: `git -c user.name="Will" -c user.email="tachiiri@westernavenu.com" commit`、本文末尾 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。scratchpad スクリプトはコミットしない。
- **翻訳フロー不変（最重要）**: 翻訳モードの対訳/再翻訳/一括翻訳/訳文編集の挙動を変えない。**担保方法＝手動編集の保存で `isManualEdit=!isTranslation` を渡し、翻訳では自動ロック・保護バッジを付けない**（Task 2・Task 3・Task 4 で実装、Task 6 Step 7 で検証）。
- **決定（設計書＋本レビュー）**: Q2=A（**非翻訳の**手動編集は初回のみ自動保護。`bodyEditedAt` 未設定かつ未ロックのときだけ `locked=true`/`lockReason="manual"`。ユーザーが解除した後の再編集では自動ロックしない）。旧版は `bodyHistory`（最大10版）。**連続手動編集はまとめる**（前回の手動保存＝`d.bodyEditedAt` から5分以内なら履歴を積み増さない）。ただし**この圧縮は `isManualEdit`（＝非翻訳）のときだけ**適用し、翻訳は毎回1版積む（従来どおり）。
- `replaceDraftBody`（既存）は /terms の一括置換でも使う。**変更せず**、手動編集用に別関数 `saveManualBodyEdit` を新設。
- **文字列アンカー必須**: Task 3〜5 の置換は、下記に引用した既存コード文字列を検索して置換する。行番号は参考値。

---

## Task 1: `SectionDraft` に `bodyEditedAt` / `lockReason` を追加

**Files:** Modify `src/lib/types.ts`（`SectionDraft` 型）

**Interfaces:** Produces `SectionDraft.bodyEditedAt?: string`、`lockReason?: "user" | "manual"`。

- [ ] **Step 1: 型を追加** — `src/lib/types.ts` の以下を置換:

置換前:
```ts
  /** 波及再生成から保護するフラグ（本文を手で直した節） */
  locked?: boolean;
  /** 翻訳書モード: 過去の訳文（再生成・手動編集の前に退避。Diff比較の材料。最大10版） */
  bodyHistory?: BodyVersion[];
```
置換後:
```ts
  /** 波及再生成から保護するフラグ（本文を手で直した節） */
  locked?: boolean;
  /** ロックの由来。手動編集の自動保護="manual"、ユーザーが明示的に掛けた="user" */
  lockReason?: "user" | "manual";
  /** 最後に本文を手動編集した時刻（ISO）。「手動編集済み」バッジと自動ロック・履歴圧縮の判定に使う */
  bodyEditedAt?: string;
  /** 翻訳書モード: 過去の訳文（再生成・手動編集の前に退避。Diff比較の材料。最大10版） */
  bodyHistory?: BodyVersion[];
```

- [ ] **Step 2: 型チェック** — Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24.15.0 >/dev/null; npx tsc --noEmit` → エラーなし。

- [ ] **Step 3: コミット**
```bash
git add src/lib/types.ts
git -c user.name="Will" -c user.email="tachiiri@westernavenu.com" commit -m "$(printf 'feat: SectionDraft に bodyEditedAt / lockReason を追加（本文編集の土台）\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 2: storage に `saveManualBodyEdit(…, isManualEdit)` と `setSectionLocked` の reason 対応

**Files:** Modify `src/lib/storage.ts`（`setSectionLocked`、`replaceDraftBody` の直後に新関数）

**Interfaces:**
- Produces: `saveManualBodyEdit(chapterId, sectionId, newBody, isManualEdit: boolean): Project`（`isManualEdit`＝非翻訳の手動編集か。自動保護と履歴圧縮の両方を制御）
- Produces: `setSectionLocked(chapterId, sectionId, locked, reason?: "user" | "manual"): Project`（第4引数追加・既定 "user"）

- [ ] **Step 1: 純粋ロジックの scratchpad サニティ（実運用条件を含める）**

`$TMPDIR/pr-a.mjs`:
```js
const COALESCE = 5*60*1000;
function save(d, newBody, isManualEdit, now){
  if (d.body === newBody) return d;
  const hist = d.bodyHistory ?? [];
  const last = hist[hist.length-1];
  // 圧縮は isManualEdit のときだけ。経過は「前回の手動保存(d.bodyEditedAt)」から測る（退避版の古さではない）
  const coalesce = isManualEdit && !!last && last.note==="手動編集前" && !!d.bodyEditedAt && (now - Date.parse(d.bodyEditedAt) < COALESCE);
  const bodyHistory = coalesce ? hist : [...hist, {savedAt:d.updatedAt, body:d.body, note:"手動編集前"}].slice(-10);
  const autoLockNow = isManualEdit && !d.bodyEditedAt && !d.locked;
  const nowIso = new Date(now).toISOString();
  return { ...d, body:newBody, bodyHistory, bodyEditedAt:nowIso,
           ...(autoLockNow ? {locked:true, lockReason:"manual"} : {}), updatedAt:nowIso };
}
const p = Date.parse;
// AI生成が2時間前。その後 手動編集を連続（実運用シナリオ：要修正2の再現）
let d = { body:"AI原文", updatedAt:"2026-07-20T10:00:00Z" };
d = save(d, "手直し1", true, p("2026-07-20T12:00:00Z"));  // 初回
console.log("初回:", {locked:d.locked, reason:d.lockReason, hist:d.bodyHistory.map(h=>h.body)});
d = save(d, "手直し2", true, p("2026-07-20T12:01:00Z"));  // 1分後 → 圧縮されるべき
console.log("連続(1分後):", {hist:d.bodyHistory.map(h=>h.body)});  // ["AI原文"] のまま
// ユーザー解除 → 再編集: 再ロックしない
d = { ...d, locked:false, lockReason:undefined };
d = save(d, "手直し3", true, p("2026-07-20T12:10:00Z"));
console.log("解除後:", {locked:d.locked, reason:d.lockReason});
// 翻訳(isManualEdit=false): ロックされない & 圧縮されない（毎回1版積む＝従来どおり）
let t = { body:"訳文0", updatedAt:"2026-07-20T10:00:00Z" };
t = save(t, "訳文1", false, p("2026-07-20T12:00:00Z"));
t = save(t, "訳文2", false, p("2026-07-20T12:01:00Z"));  // 1分後でも圧縮しない
console.log("翻訳:", {locked:t.locked, histLen:t.bodyHistory.length});  // histLen=2（圧縮されない）
```

- [ ] **Step 2: サニティ実行** — Run: `node "$TMPDIR/pr-a.mjs"`
Expected: `初回` locked=true/reason=manual/hist=["AI原文"]、`連続(1分後)` hist=["AI原文"]（**圧縮が効く**）、`解除後` locked=false（再ロックしない）、`翻訳` locked=undefined/**histLen=2**（isManualEdit=false なので**圧縮されず毎回1版積む＝従来どおり**）。

- [ ] **Step 3: `setSectionLocked` に reason を追加** — `src/lib/storage.ts` の `setSectionLocked` を置換:
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

- [ ] **Step 4: `saveManualBodyEdit` を追加** — `replaceDraftBody` の末尾（次の文字列で終わる）を検索し、その直後に新関数を挿入（`replaceDraftBody` 本体は変更しない）:

アンカー（この行群の直後に挿入）:
```ts
      return { ...d, body: newBody, bodyHistory: history, updatedAt: new Date().toISOString() };
    }),
  }));
}
```
挿入する新関数:
```ts
/**
 * 本文の手動編集を保存する（全ジャンル共通）。
 * 第4引数 isManualEdit は「非翻訳の手動編集か」＝自動保護と履歴圧縮の**両方**を制御する。
 * - 旧本文を bodyHistory に退避（最大10版）。isManualEdit のときだけ、前回の手動保存(bodyEditedAt)から
 *   5分以内の連続編集は積み増さずまとめる（AI 生成版が履歴から押し出されるのを防ぐ）。
 * - bodyEditedAt を更新。
 * - isManualEdit=true かつ初回(bodyEditedAt 未設定)かつ未ロックのときのみ自動保護(locked/lockReason="manual")。
 * - **翻訳モードは isManualEdit=false で呼ぶ**＝自動保護もしない・履歴圧縮もしない（毎回1版積む＝従来の
 *   replaceDraftBody と同じ挙動）。波及・一括翻訳の対象からも外さない。
 */
export function saveManualBodyEdit(
  chapterId: string,
  sectionId: string,
  newBody: string,
  isManualEdit: boolean,
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
        isManualEdit &&
        !!last &&
        last.note === "手動編集前" &&
        !!d.bodyEditedAt &&
        Date.now() - Date.parse(d.bodyEditedAt) < HISTORY_COALESCE_MS;
      const bodyHistory = coalesce
        ? hist
        : [...hist, { savedAt: d.updatedAt, body: d.body, note: "手動編集前" }].slice(-10);
      const autoLockNow = isManualEdit && !d.bodyEditedAt && !d.locked;
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

- [ ] **Step 5: 型チェック＋ビルド** — Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24.15.0 >/dev/null; npx tsc --noEmit && npx next build 2>&1 | grep -iE "Failed|error:|✓ Generating"` → tsc なし・build 成功。

- [ ] **Step 6: コミット**
```bash
git add src/lib/storage.ts
git -c user.name="Will" -c user.email="tachiiri@westernavenu.com" commit -m "$(printf 'feat: saveManualBodyEdit（履歴圧縮＝bodyEditedAt基準・isManualEdit引数で翻訳は保護・圧縮しない）と setSectionLocked の reason 対応\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 3: 本文編集を全ジャンルに開放（ボタン・textarea・保存＝isManualEditは非翻訳のみ）

**Files:** Modify `src/app/writer/page.tsx`

**Interfaces:** Consumes `saveManualBodyEdit`（Task 2）。`editingBody: boolean` は据え置き。

前提（確認済み）: `handleStartEditBody` は `setBodyDraft(currentDraft.body); setEditingBody(true); setTrView("target");` のみ。`setTrView("target")` は翻訳の描画ブランチしか読まないので**非翻訳で押しても無害**。よって全ジャンル共有のまま変更不要。

- [ ] **Step 1: import に `saveManualBodyEdit` を追加** — storage からの import 群（`replaceDraftBody,` がある塊）に `saveManualBodyEdit,` を足す。

- [ ] **Step 2: `handleSaveBody` を付け替え（isManualEdit=非翻訳）** — 次を検索して置換:

置換前:
```tsx
  function handleSaveBody() {
    if (!selected || !currentDraft) return;
    const next = replaceDraftBody(
      selected.chapter.id,
      selected.section.id,
      bodyDraft,
      "手動編集前",
    );
    setProject(next);
    setEditingBody(false);
  }
```
置換後:
```tsx
  function handleSaveBody() {
    if (!selected || !currentDraft) return;
    // isManualEdit=!isTranslation。翻訳は自動ロックも履歴圧縮もしない＝従来どおり毎回1版積む
    // （波及・一括翻訳の対象から外さない／訳文の「変更差分」から中間版が消えない）。
    const next = saveManualBodyEdit(
      selected.chapter.id,
      selected.section.id,
      bodyDraft,
      !isTranslation,
    );
    setProject(next);
    setEditingBody(false);
  }
```

※ 元の `handleSaveBody` に無かった `syncSelectedFrom` は**足さない**（本文は `SectionDraft` 側にあり `selected.section` には無いので、保存後の `currentDraft` は `setProject` で自動的に新 body を反映する。翻訳パスに新たな副作用を持ち込まない＝翻訳フロー不変）。

- [ ] **Step 3: 「本文を編集」ボタンを全ジャンルに開放（一箇所で完結）** — 次を検索して置換:

置換前:
```tsx
                    {isTranslation && currentDraft && !editingBody ? (
                      <button className="btn" onClick={handleStartEditBody} type="button">
                        訳文を編集
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
```

- [ ] **Step 4: 非翻訳の本文表示に編集 textarea を追加** — まずアンカーが一意であることを確認（確認済み: `（本文が空です）` は1件、`（訳文が空です）` は2件で別物）:

Run: `grep -c '（本文が空です）' src/app/writer/page.tsx`
Expected: `1`（2以上なら別の一意アンカーに絞ること）。

次を検索して置換（非翻訳ブランチの読み取り専用 div）:

置換前:
```tsx
                  ) : (
                    <div className="draft-body">{currentDraft.body || "（本文が空です）"}</div>
                  )}
```
置換後:
```tsx
                  ) : editingBody ? (
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
                        <button className="btn" type="button" onClick={() => setEditingBody(false)}>
                          キャンセル
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="draft-body">{currentDraft.body || "（本文が空です）"}</div>
                  )}
```

- [ ] **Step 5: 型チェック＋ビルド** — Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24.15.0 >/dev/null; npx tsc --noEmit && npx next build 2>&1 | grep -iE "Failed|error:|✓ Generating"` → tsc なし・build 成功。

- [ ] **Step 6: コミット**
```bash
git add src/app/writer/page.tsx
git -c user.name="Will" -c user.email="tachiiri@westernavenu.com" commit -m "$(printf 'feat: 本文の手動編集を全ジャンルに開放（編集ボタン・textarea・saveManualBodyEditで非翻訳のみ自動保護）\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 4: 安全挙動（手動編集バッジ〔非翻訳のみ〕・単体再生成の確認）

**Files:** Modify `src/app/writer/page.tsx`

- [ ] **Step 1: 「手動編集済み（保護中）」バッジ（非翻訳のみ）** — 節タイトルの直後に足す。次を検索:
```tsx
                    <h2 style={{ fontSize: 15, marginTop: 2 }}>{selected.section.title}</h2>
```
その直後に追加:
```tsx
                    {!isTranslation && currentDraft?.bodyEditedAt ? (
                      <span className="badge warn" style={{ fontSize: 10, marginTop: 4, display: "inline-block" }}>
                        手動編集済み{currentDraft.locked ? "（保護中）" : ""}
                      </span>
                    ) : null}
```
（保護の有無は `lockReason` ではなく `currentDraft.locked` で判定する＝ユーザーが先に明示ロック〔`lockReason="user"`〕した節を手動編集した場合も「保護中」が正しく出る。翻訳はバッジを出さない＝UI不変。）

- [ ] **Step 2: 保護中の節の単体再生成に確認**（`handleGenerate` は force=true で呼ばれる＝既存ドラフトの「本文を再生成」ボタン。確認済み） — 次を検索:
```tsx
  async function handleGenerate(force = false) {
    if (!project || !selected) return;
    setError(null);
    setLoading(true);
```
置換後（確認を冒頭に挿入）:
```tsx
  async function handleGenerate(force = false) {
    if (!project || !selected) return;
    // 手動編集して保護中の節（非翻訳）を再生成すると編集が失われるため確認する
    if (
      force &&
      !isTranslation &&
      currentDraft?.bodyEditedAt &&
      currentDraft.locked &&
      !confirm("この節は手動編集され保護中です。再生成すると手動編集が失われます（旧版は変更差分から復元できます）。再生成しますか？")
    ) {
      return;
    }
    setError(null);
    setLoading(true);
```
（判定は `currentDraft.locked` で行う〔`lockReason` に依存しない〕＝明示ロック中に手動編集した節でも確認が出て編集消失を防ぐ。なお、手動編集後にユーザーが保護を外した節は確認なしで再生成される〔＝解除は再生成の許可と解釈〕。v1 の割り切り。）

- [ ] **Step 3: 型チェック＋ビルド** — （Task 2 Step 5 と同じコマンド）→ tsc なし・build 成功。

- [ ] **Step 4: コミット**
```bash
git add src/app/writer/page.tsx
git -c user.name="Will" -c user.email="tachiiri@westernavenu.com" commit -m "$(printf 'feat: 手動編集バッジ（非翻訳）と、保護中の節の単体再生成に確認ダイアログ\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 5: 未保存のまま節切替の確認 ＋ 非翻訳の差分表示

**Files:** Modify `src/app/writer/page.tsx`

- [ ] **Step 1: 差分表示用の state を追加** — `const [bodyDraft, setBodyDraft] = useState("");` を検索し、その直後に:
```tsx
  const [showBodyDiff, setShowBodyDiff] = useState(false);
```

- [ ] **Step 2: 未保存ガード付きの節選択ハンドラを追加** — `function handleSaveBody() {` を検索し、その関数の直前に追加:
```tsx
  function handleSelectSection(chapter: Chapter, section: Section) {
    if (
      editingBody &&
      currentDraft &&
      bodyDraft !== currentDraft.body &&
      !confirm("未保存の編集があります。破棄して移動しますか？")
    ) {
      return;
    }
    setEditingBody(false);
    setShowBodyDiff(false);
    setSelected({ chapter, section });
  }
```

- [ ] **Step 3: 左ツリーのクリックを差し替え** — 次を検索して置換:
```tsx
                          onClick={() => setSelected({ chapter: c, section: s })}
```
置換後:
```tsx
                          onClick={() => handleSelectSection(c, s)}
```

- [ ] **Step 4: 非翻訳に「変更差分」トグルを追加** — Task 3 Step 4 で作った非翻訳の最終 `else` ブロック（読み取り専用 div）を次に置換:

置換前:
```tsx
                  ) : (
                    <div className="draft-body">{currentDraft.body || "（本文が空です）"}</div>
                  )}
```
置換後:
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
                          const hist = currentDraft.bodyHistory;
                          if (!hist?.length) return null;
                          const base = hist[hist.length - 1];
                          const lines = diffLines(base.body, currentDraft.body);
                          const stats = diffStats(lines);
                          return (
                            <div className="draft-body">
                              <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>
                                前の版（{base.savedAt.slice(0, 16).replace("T", " ")}）との差分　+{stats.added} / -{stats.removed}
                              </div>
                              {lines.map((ln, i) => (
                                <div key={i} className={`diff-line ${ln.type}`}>{ln.text || " "}</div>
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
（`diffLines`/`diffStats` は翻訳ブランチで import 済み。`diff-line` CSS は既存。`ln.type`/`ln.text` は翻訳の差分表示と同じ使い方。実装前に翻訳側の diff レンダリング〔`diffLines(base.body, currentDraft.body)` を使う箇所〕を見て、`ln` のプロパティ名〔`type`/`text`〕を一致させること。）

- [ ] **Step 5: 型チェック＋ビルド** — （同コマンド）→ tsc なし・build 成功。

- [ ] **Step 6: コミット**
```bash
git add src/app/writer/page.tsx
git -c user.name="Will" -c user.email="tachiiri@westernavenu.com" commit -m "$(printf 'feat: 未保存のまま節切替の確認と、非翻訳の変更差分トグル\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 6: リグレッション検証（コントローラ／ブラウザ）

**Files:** 変更なし（検証のみ。不具合は該当 Task に戻す）。論文プロジェクトと翻訳プロジェクトの両方で行う。

- [ ] **Step 1: 非翻訳の編集フロー** — 本文生成済みの節で「本文を編集」→編集→「保存」→本文更新。バッジ「手動編集済み（保護中）」表示。localStorage で当該 SectionDraft に `bodyEditedAt`、`locked===true`、`lockReason==="manual"`、`bodyHistory` に旧版（note "手動編集前"）。
- [ ] **Step 2: 自動ロックと解除の記憶** — 「保護」を外す→`locked=false`・`lockReason` クリア。再編集→保存でも**再ロックされない**（`locked` false のまま、`bodyEditedAt` 更新）。
- [ ] **Step 3: 履歴圧縮（要修正2の回帰）** — 同じ節を短時間に2〜3回保存→`bodyHistory` の「手動編集前」が積み増されず、最初の版が保持。**AI生成が過去（updatedAt が古い）でも圧縮が効く**ことを確認。
- [ ] **Step 4: 単体再生成の確認** — 保護中（手動編集）の節で「本文を再生成」→確認ダイアログ。キャンセルで再生成されない。
- [ ] **Step 5: 未保存切替** — 編集中（未保存）に左ツリーで別節クリック→確認ダイアログ。破棄で移動・編集破棄、キャンセルで留まる。
- [ ] **Step 6: 非翻訳の差分** — 編集済み節で「変更差分」トグル→旧版との差分表示→「本文に戻す」で本文へ。
- [ ] **Step 7: 翻訳モード不変（最重要・要修正1の回帰）** — 翻訳プロジェクトで:
  - 対訳/訳文/変更差分タブが従来通り。訳文編集→タブ切替→戻って保存で正しく訳文が保存される。
  - **訳文保存後も編集していた節が選択されたまま、対訳表示が崩れない**（`syncSelectedFrom` を足していないことの確認）。
  - **訳文を編集・保存しても、その節が `locked` にならない**（localStorage で `locked` が立たない）＝一括翻訳・波及再翻訳の対象から外れない。保護バッジも出ない。
  - **訳文を短時間（5分以内）に2回保存 → `bodyHistory` が2版増える**（isManualEdit=false で圧縮されない＝従来どおり）。翻訳の「変更差分」から中間版が消えないこと。
  - 一括翻訳・（あれば）波及再翻訳が従来通り全対象を処理する。
- [ ] **Step 8: `/terms` 一括置換の回帰** — 翻訳プロジェクトの `/terms` で用語の一括置換を実行→対象節が `locked` にならない（`replaceDraftBody` は未変更なので理屈上安全だが、Self-Review で「壊さない」と主張しているため実確認する）。
- [ ] **Step 9: console エラーが無いこと**（`read_console_messages` onlyErrors）。不具合は該当 Task に戻して修正・再検証。

---

## 非スコープ（今回やらない・明記）

- **未保存ガードは左ツリーのクリックのみ**を守る。編集中に「本文を再生成」「章の折りたたみ」「プロジェクト切替」を行う経路は素通り（v1 割り切り）。
- 差分の比較元は「直近の退避版1つ」に固定（翻訳のような版セレクタは付けない）。
- **履歴圧縮に上限時間の cap は設けない**: 5分以内の連続保存が続く限り中間版は積まれず、「AI生成版（＝最初の退避版）1つ＋現行」が残るのが仕様（半日編集し続けても中間版は残らない）。
- **手動編集後にユーザーが保護を外した節は、確認なしで再生成される**（解除＝再生成の許可と解釈）。
- リッチテキスト編集はしない（プレーン textarea）。

## Self-Review（スペック突合）

- **SectionDraft.bodyEditedAt / lockReason**（spec P1）→ Task 1 ✅
- **本文編集を全ジャンルに開放**（spec PR-A）→ Task 3 ✅
- **翻訳フロー不変**（Global Constraint・最重要）→ **設計担保: `handleSaveBody` が `isManualEdit=!isTranslation`（Task 3 Step 2）＋ バッジ/確認を `!isTranslation` で分岐（Task 4）**。検証 Task 6 Step 7 ✅（← 今回の要修正1の是正。設計パスが Task に存在する）
- **非翻訳の初回のみ自動保護・解除の記憶**（spec Q2=A・P1）→ Task 2（判定）＋ Task 4（バッジ）＋ Task 6 Step 2 ✅
- **bodyHistory 圧縮（bodyEditedAt 基準）**（spec P3・要修正2）→ Task 2 ✅（scratchpad に古い updatedAt ケース有）
- **未保存のまま節切替の確認**（spec P2）→ Task 5 ✅
- **単体再生成でロック節の扱い**（spec 実装時確認点）→ Task 4（force=true 確認済み）✅
- **非翻訳の差分ビュー**（spec PR-A）→ Task 5 ✅
- `replaceDraftBody` を壊さず別関数（/terms 一括置換は自動ロックさせない）→ Task 2 ✅

Placeholder スキャン: 曖昧語なし・全コードブロック実体あり。文字列アンカーで Task 間の行ズレを回避。型整合: `editingBody: boolean`（据え置き）、`saveManualBodyEdit(chapterId, sectionId, newBody, isManualEdit)`、`setSectionLocked(…, reason?)`、`showBodyDiff`、`handleSelectSection` は各 Task 間で一致。
