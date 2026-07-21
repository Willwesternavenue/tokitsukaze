# PR-B2: 本文エディタでの引用挿入ピッカー — 実装計画（レビュー反映・改訂）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 行番号ではなく本文中の文字列をアンカーに置換すること。

**Goal:** 論文モードの本文エディタ（PR-A の textarea）に「引用を挿入」ピッカーを足し、登録文献を選んでカーソル位置に正準マーカー〔著者, 年〕を挿入できるようにする。**インライン式・スタイル非依存**（脚注モードは別PR-B3）。

**Architecture:** PR-A の非翻訳編集 textarea に ref を付け、キャレット位置を state で追跡（ボタン押下でフォーカスが外れても位置を保持）。「引用を挿入」で `project.references` のピッカーを開き、選択で `authorYearMarker(ref)`（PR-B1/citation.ts の正準形）を `bodyDraft` のキャレット位置へ差し込む。保存は PR-A の `handleSaveBody`。挿入マーカーは既存の `citation-check` 突合・`docx` スタイル変換にそのまま乗る（追加改修不要）。

**Tech Stack:** Next.js 14 / TypeScript / React（useRef/useState/useEffect）/ 既存 `src/lib/citation.ts`（`authorYearMarker`）。

## Global Constraints

- **前提: PR-B1（#7）マージ済み**。`Section.referenceIds` が型に存在すること（未マージだと `selected.section.referenceIds` 参照で tsc が落ちる）。本ブランチは PR-B1 マージ後の main から分岐しているので満たす。なお PR-B1 の `handleToggleSectionReference` は `syncSelectedFrom` を呼ぶため、チェックリストで紐付けを変えても `selected` が更新され、ピッカーの ★ 表示は古くならない（確認済み）。
- **テストランナーは無い**。検証は `npx tsc --noEmit`、`npx next build`、ブラウザ実機。
- **tsc/build は Node 24**: 各コマンド前に `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24.15.0 >/dev/null`。build 成功＝`✓ Generating static pages`（`unpdf` warning は既存・無視）。
- **コミット**: `git -c user.name="Will" -c user.email="tachiiri@westernavenu.com" commit`、本文末尾 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。
- **スコープ**: 論文モードのみ（`genre==="paper"` かつ `references.length>0`）。挿入するのは常に `authorYearMarker(ref)`（スタイル非依存）。脚注モード・`citationStyle` 型追加・docx 分岐は**やらない**（PR-B3）。
- **selectionStart 消失対策必須**: ボタン押下で textarea からフォーカスが外れ選択位置が失われるため、textarea の `onSelect`/`onClick`/`onKeyUp` でキャレット位置を state に保持し、ピッカーの各ボタンは `onMouseDown` で `preventDefault()` してフォーカスを奪わない。
- **編集対象は PR-A の非翻訳ブロックのみ**（`) : editingBody ? (` の後の textarea 塊。**翻訳ブロックの `editingBody ? (` には触らない**。両者は `保存（旧版を退避）` を持つため、アンカーは `) : editingBody ? (`〔一意〕で識別する）。
- **文字列アンカー必須**。行番号は参考値。

---

## Task 1: 「引用を挿入」ピッカーと本文への挿入

**Files:** Modify `src/app/writer/page.tsx`

**Interfaces:** Consumes `authorYearMarker`（`@/lib/citation`）、`project.references`、`selected.section.referenceIds`（PR-B1）、`bodyDraft`/`setBodyDraft`（PR-A）。

- [ ] **Step 0: 裏取り（実装前に事実確認）**

Run 各コマンド。想定と違えば実装を止めて報告:
- `grep -c 'project.genre === "paper"' src/app/writer/page.tsx` → **1以上**（PR-B1 のチェックリストで既に使用＝`genre`/`"paper"` 実在）
- `grep -c ') : editingBody ? (' src/app/writer/page.tsx` → **1**（非翻訳ブロックの一意アンカー。`保存（旧版を退避）` は2件あるので使わない）
- `grep -nE '\.nav-dropdown(-menu|-item)? \{' src/app/globals.css` → 3クラスとも定義あり（`.nav-dropdown{position:relative}` / `.nav-dropdown-menu{position:absolute;left:0}`）。メニューは既定 `left:0` なので右寄せは inline style で `left:"auto", right:0` を指定する

- [ ] **Step 1: import と state / ref を追加**

import に追加:
```tsx
import { authorYearMarker } from "@/lib/citation";
```
`const [bodyDraft, setBodyDraft] = useState("");` を検索し、その直後に:
```tsx
  const bodyTextareaRef = useRef<HTMLTextAreaElement>(null);
  const citePickerRef = useRef<HTMLDivElement>(null);
  const [citePickerOpen, setCitePickerOpen] = useState(false);
  // 本文編集の最後のキャレット位置（ピッカーのボタンでフォーカスが外れても保持する）
  const [bodySel, setBodySel] = useState<{ start: number; end: number }>({ start: 0, end: 0 });
```

- [ ] **Step 2: `handleStartEditBody` にキャレット初期位置（末尾）を追加**

（要修正2。`bodySel` の初期値 `{0,0}` のままだと、キャレットを動かさず挿入すると**本文先頭**に入ってしまう。編集開始時に末尾へ初期化する。`bodySel` は非翻訳の挿入にしか読まれないので、共有ハンドラでも**翻訳フローに無害**。）次を検索して置換:

置換前:
```tsx
  function handleStartEditBody() {
    if (!currentDraft) return;
    setBodyDraft(currentDraft.body);
    setEditingBody(true);
    setTrView("target");
  }
```
置換後:
```tsx
  function handleStartEditBody() {
    if (!currentDraft) return;
    setBodyDraft(currentDraft.body);
    // 挿入の既定位置は本文末尾（キャレット未移動でも先頭に入らないように）。bodySel は非翻訳の挿入専用で翻訳に無害
    setBodySel({ start: currentDraft.body.length, end: currentDraft.body.length });
    setEditingBody(true);
    setTrView("target");
  }
```

- [ ] **Step 3: 挿入ハンドラと外側クリックで閉じる useEffect を追加**

`function handleSaveBody() {` を検索し、その**直前**に追加:
```tsx
  // 本文編集: キャレット位置を保持（ピッカーのボタン押下でフォーカスが外れる前の位置を使う）
  function rememberBodySel() {
    const ta = bodyTextareaRef.current;
    if (ta) setBodySel({ start: ta.selectionStart, end: ta.selectionEnd });
  }

  // 引用マーカー〔著者, 年〕を保持したキャレット位置に挿入する
  function insertCitation(refId: string) {
    const ref = (project?.references ?? []).find((r) => r.id === refId);
    if (!ref) return;
    const marker = authorYearMarker(ref);
    const start = Math.min(bodySel.start, bodyDraft.length);
    const end = Math.min(Math.max(bodySel.end, start), bodyDraft.length);
    const next = bodyDraft.slice(0, start) + marker + bodyDraft.slice(end);
    setBodyDraft(next);
    setCitePickerOpen(false);
    const caret = start + marker.length;
    setBodySel({ start: caret, end: caret });
    requestAnimationFrame(() => {
      const ta = bodyTextareaRef.current;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(caret, caret);
      }
    });
  }
```
外側クリック/Escで閉じる（Nav の nav-dropdown と同じ作法）。`useEffect(() => {` が並ぶ既存フックの近く（コンポーネント上部の他の useEffect の後）に追加:
```tsx
  useEffect(() => {
    if (!citePickerOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (citePickerRef.current && !citePickerRef.current.contains(e.target as Node)) {
        setCitePickerOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setCitePickerOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onKey);
    };
  }, [citePickerOpen]);
```

- [ ] **Step 4: 編集を抜ける経路でピッカーを閉じる（要修正1）**

開いたまま次回編集で開いた状態から始まる事故を防ぐ。3箇所を修正:

(a) `handleSaveBody` — `setEditingBody(false);` を検索（`handleSaveBody` 内）し、その直後に `setCitePickerOpen(false);` を足す:
```tsx
    setProject(next);
    setEditingBody(false);
    setCitePickerOpen(false);
  }
```
(b) `handleSelectSection` — `setEditingBody(false);` を検索（`handleSelectSection` 内、`setShowBodyDiff(false);` の並び）し、`setCitePickerOpen(false);` を足す:
```tsx
    setEditingBody(false);
    setShowBodyDiff(false);
    setCitePickerOpen(false);
    setSelected({ chapter, section });
```
(c) 非翻訳ブロックのキャンセルボタン — Step 5 の置換後コードでキャンセルの `onClick` が `() => { setEditingBody(false); setCitePickerOpen(false); }` になっている（Step 5 に含む）。

- [ ] **Step 5: 非翻訳の編集 textarea に ref・選択追跡・ピッカーを付ける**

`grep -c ') : editingBody ? (' src/app/writer/page.tsx` が 1 であることを再確認してから、次を検索して置換:

置換前:
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
```
置換後:
```tsx
                  ) : editingBody ? (
                    <>
                      <textarea
                        ref={bodyTextareaRef}
                        className="input mono"
                        rows={18}
                        value={bodyDraft}
                        onChange={(e) => setBodyDraft(e.target.value)}
                        onSelect={rememberBodySel}
                        onKeyUp={rememberBodySel}
                        onClick={rememberBodySel}
                      />
                      <div className="flex" style={{ marginTop: 8, gap: 8, alignItems: "flex-start" }}>
                        <button className="btn primary" type="button" onClick={handleSaveBody}>
                          保存（旧版を退避）
                        </button>
                        <button
                          className="btn"
                          type="button"
                          onClick={() => {
                            setEditingBody(false);
                            setCitePickerOpen(false);
                          }}
                        >
                          キャンセル
                        </button>
                        {project.genre === "paper" && (project.references?.length ?? 0) > 0 ? (
                          <div className="nav-dropdown" ref={citePickerRef} style={{ marginLeft: "auto" }}>
                            <button
                              className="btn"
                              type="button"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => setCitePickerOpen((o) => !o)}
                            >
                              引用を挿入 ▾
                            </button>
                            {citePickerOpen ? (
                              <div
                                className="nav-dropdown-menu"
                                role="menu"
                                style={{ left: "auto", right: 0, maxHeight: 260, overflowY: "auto" }}
                              >
                                {[...project.references]
                                  .sort((a, b) => {
                                    const linked = selected.section.referenceIds ?? [];
                                    return (linked.includes(b.id) ? 1 : 0) - (linked.includes(a.id) ? 1 : 0);
                                  })
                                  .map((r) => (
                                    <button
                                      key={r.id}
                                      type="button"
                                      role="menuitem"
                                      className="nav-dropdown-item"
                                      style={{ textAlign: "left" }}
                                      onMouseDown={(e) => e.preventDefault()}
                                      onClick={() => insertCitation(r.id)}
                                      title={[r.author, r.year, r.source].filter(Boolean).join(" ")}
                                    >
                                      {(selected.section.referenceIds ?? []).includes(r.id) ? "★ " : ""}
                                      {authorYearMarker(r)}{r.title ? ` ${r.title}` : ""}
                                    </button>
                                  ))}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                      <p className="help" style={{ marginTop: 6 }}>
                        カーソル位置に引用マーカー〔著者, 年〕を挿入します（★は この節に紐付けた文献）。体裁はWord出力時に選択スタイルへ変換されます。
                      </p>
                    </>
                  ) : (
```

- [ ] **Step 6: 型チェック＋ビルド**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24.15.0 >/dev/null; npx tsc --noEmit && npx next build 2>&1 | grep -iE "Failed|error:|✓ Generating"`
Expected: tsc エラーなし・build 成功。

- [ ] **Step 7: コミット**
```bash
git add src/app/writer/page.tsx
git -c user.name="Will" -c user.email="tachiiri@westernavenu.com" commit -m "$(printf 'feat: 本文エディタに引用挿入ピッカー（論文・カーソル位置に正準マーカー・外側クリックで閉じる・末尾初期化）\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 2: ブラウザ検証（コントローラ）

論文プロジェクト・文献1件以上・本文生成済みの節で行う。

- [ ] **Step 1: 表示条件** — 論文＋文献登録済みの節で「本文を編集」→「引用を挿入 ▾」が出る。文献0件では出ない。
- [ ] **Step 2: カーソル位置に挿入** — textarea 本文の**途中**にキャレットを置く（クリック）→「引用を挿入」→ 文献を選ぶ →「その位置」に `authorYearMarker`（例 `〔Devlin, 2019〕`）が入る（末尾追記でない）。★（節紐付け）が上に並ぶ。
- [ ] **Step 3: 末尾初期化と selectionStart 保持** — 編集開始直後（キャレット未移動）に挿入 → **本文末尾**に入る（先頭でない）。中ほどをクリックしてから挿入 → その位置に入る（`bodySel` 保持の確認）。
- [ ] **Step 4: ピッカーの閉じ挙動** — 開いた状態で (a) textarea をクリック→閉じる、(b) Esc→閉じる、(c) 保存→編集終了後もう一度「本文を編集」→ピッカーは閉じた状態で始まる、(d) キャンセル→同上、(e) 別節へ移動→同上。
- [ ] **Step 5: 保存と整合** — 挿入後「保存」→ `SectionDraft.body` に挿入マーカーが残る（論文なので保存で自動保護 `locked=true`）。挿入マーカーは正準形なので本文に正しく入ることを確認（`citation-check`・Word変換は既存パイプライン）。
- [ ] **Step 6: 非論文で非表示（二重ガードの確認）** — 翻訳の訳文編集では「引用を挿入」が出ない。これは `genre` 判定に加え、そもそもこの UI が非翻訳ブロックにしか無いため＝**二重に守られていることの確認**。
- [ ] **Step 7: console エラーなし**（`read_console_messages` onlyErrors）。不具合は Task 1 に戻す。

---

## 非スコープ（今回やらない・明記）

- **脚注モード**（Chicago ノート式／和文脚注）は **PR-B3**（別設計書）。`citationStyle` 型追加・`citation.ts` フォーマッタ・`docx.ts` 脚注出力・`citation-check` 波及は触らない。
- 挿入マーカーは常に `authorYearMarker`（スタイル非依存）。番号[n]/MLA への「挿入時」変換はしない（Word出力時に既存パイプラインが変換）。
- **同一著者・同年の曖昧性**: `authorYearMarker` は 2020a/2020b の付番を持たないため、ピッカーから別々の文献を選んでも同一マーカーになり `citation-check`・参考文献リストが区別できない。ピッカー導入で手動でも踏みやすくなるが、v1は非対応（PR-B3 か別途で付番対応）。
- **ネイティブ Undo**: `setBodyDraft` でプログラム的に差し替えるため、挿入直後の Ctrl+Z で挿入前へは戻れない（手で消せるので v1 許容）。
- ページ番号つき引用（`〔著者, 年, p.12〕`）は非対応。翻訳エディタへのピッカーも付けない。

## Self-Review（スペック突合）

- **挿入ピッカー（論文・文献1件以上でのみ表示）** → Task 1 Step 5 ✅
- **カーソル位置に `authorYearMarker` を挿入（スタイル非依存）** → Task 1 Step 3/5 ✅
- **selectionStart 保持（onSelect保持＋onMouseDown preventDefault）＋末尾初期化** → Task 1 Step 2/3/5、要修正2対応 ✅
- **ピッカーの閉じ経路（3exit＋外側クリック＋Esc）** → Task 1 Step 3/4、要修正1対応 ✅
- **PR-B1 依存明記＋★非stale** → Global Constraints ✅
- **裏取り（genre/CSS/アンカー一意）** → Task 1 Step 0 ✅
- **保存はPR-A流用・整合は既存パイプライン** → Task 1（handleSaveBody は close 追加のみ）＋ Task 2 Step 5 ✅
- **脚注/付番/undoは非スコープ** → 非スコープ節に明記 ✅

Placeholder スキャン: 曖昧語なし・全コードブロック実体あり。型整合: `bodyTextareaRef`/`citePickerRef`/`citePickerOpen`/`bodySel`/`insertCitation`/`rememberBodySel` は Task 内で一貫。
