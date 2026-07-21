# PR-B2: 本文エディタでの引用挿入ピッカー — 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 行番号ではなく本文中の文字列をアンカーに置換すること。

**Goal:** 論文モードの本文エディタ（PR-A の textarea）に「引用を挿入」ピッカーを足し、登録文献を選んでカーソル位置に正準マーカー〔著者, 年〕を挿入できるようにする。**インライン式・スタイル非依存**（脚注モードは別PR-B3）。

**Architecture:** PR-A の非翻訳編集 textarea に ref を付け、キャレット位置を state で追跡（ボタン押下でフォーカスが外れても位置を保持）。「引用を挿入」ボタンで `project.references` のピッカーを開き、選択で `authorYearMarker(ref)`（PR-B1/citation.ts の正準形）を `bodyDraft` のキャレット位置へ差し込む。保存は PR-A の `handleSaveBody`（論文＝非翻訳なので自動保護が掛かる）。挿入マーカーは既存の `citation-check` 突合・`docx` スタイル変換にそのまま乗る（追加改修不要）。

**Tech Stack:** Next.js 14 / TypeScript / React（useRef/useState）/ 既存 `src/lib/citation.ts`（`authorYearMarker`）。

## Global Constraints

- **テストランナーは無い**。検証は `npx tsc --noEmit`、`npx next build`、ブラウザ実機。
- **tsc/build は Node 24**: 各コマンド前に `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24.15.0 >/dev/null`。build 成功＝`✓ Generating static pages`（`unpdf` warning は既存・無視）。
- **コミット**: `git -c user.name="Will" -c user.email="tachiiri@westernavenu.com" commit`、本文末尾 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。
- **スコープ**: 論文モードのみ（`genre==="paper"` かつ `references.length>0` のときだけピッカーを出す）。**インライン式**：挿入するのは常に `authorYearMarker(ref)`（スタイル非依存）。脚注モード・`citationStyle` 型追加・docx 分岐は**やらない**（PR-B3）。
- **selectionStart 消失対策必須**: ボタン押下で textarea からフォーカスが外れ選択位置が失われるため、textarea の `onSelect`/`onClick`/`onKeyUp` でキャレット位置を state に保持し、ピッカー行は `onMouseDown` で `preventDefault()` してフォーカスを奪わない。
- **編集対象は PR-A の非翻訳ブロックのみ**（`) : editingBody ? (` の後の `<textarea value={bodyDraft} …>` 塊。翻訳ブロックの textarea には触らない）。

---

## Task 1: 「引用を挿入」ピッカーと本文への挿入

**Files:** Modify `src/app/writer/page.tsx`

**Interfaces:**
- Consumes: `authorYearMarker`（`@/lib/citation`）、`project.references`、`selected.section.referenceIds`、`bodyDraft`/`setBodyDraft`（PR-A）。
- Produces: 論文の本文編集中に「引用を挿入」で正準マーカーをカーソル位置へ挿入できる。

- [ ] **Step 1: import と state / ref を追加**

`src/app/writer/page.tsx` の import に追加（既存の import 群の近く）:
```tsx
import { authorYearMarker } from "@/lib/citation";
```
state/ref を追加（`const [bodyDraft, setBodyDraft] = useState("");` を検索し、その直後に）:
```tsx
  const bodyTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [citePickerOpen, setCitePickerOpen] = useState(false);
  // 本文編集の最後のキャレット位置（ピッカーのボタンでフォーカスが外れても保持する）
  const [bodySel, setBodySel] = useState<{ start: number; end: number }>({ start: 0, end: 0 });
```
（`useRef` は既に `react` から import 済み。未 import なら import に足す。）

- [ ] **Step 2: 挿入ハンドラを追加**

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
    const end = Math.min(Math.max(bodySel.end, bodySel.start), bodyDraft.length);
    const next = bodyDraft.slice(0, start) + marker + bodyDraft.slice(end);
    setBodyDraft(next);
    setCitePickerOpen(false);
    const caret = start + marker.length;
    setBodySel({ start: caret, end: caret });
    // 再フォーカスしてキャレットをマーカーの後ろへ
    requestAnimationFrame(() => {
      const ta = bodyTextareaRef.current;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(caret, caret);
      }
    });
  }
```

- [ ] **Step 3: 非翻訳の編集 textarea に ref と選択追跡を付け、ピッカーを足す**

次を検索して置換（PR-A が作った非翻訳の編集ブロック）:

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
                        <button className="btn" type="button" onClick={() => setEditingBody(false)}>
                          キャンセル
                        </button>
                        {project.genre === "paper" && (project.references?.length ?? 0) > 0 ? (
                          <div className="nav-dropdown" style={{ marginLeft: "auto" }}>
                            <button
                              className="btn"
                              type="button"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => setCitePickerOpen((o) => !o)}
                            >
                              引用を挿入 ▾
                            </button>
                            {citePickerOpen ? (
                              <div className="nav-dropdown-menu" role="menu" style={{ right: 0, maxHeight: 260, overflowY: "auto" }}>
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
                                      title={authorYearMarker(r)}
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

- [ ] **Step 4: 型チェック＋ビルド**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24.15.0 >/dev/null; npx tsc --noEmit && npx next build 2>&1 | grep -iE "Failed|error:|✓ Generating"`
Expected: tsc エラーなし・build 成功。

- [ ] **Step 5: コミット**
```bash
git add src/app/writer/page.tsx
git -c user.name="Will" -c user.email="tachiiri@westernavenu.com" commit -m "$(printf 'feat: 本文エディタに引用挿入ピッカー（論文・カーソル位置に正準マーカー挿入・スタイル非依存）\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 2: ブラウザ検証（コントローラ）

**Files:** 変更なし（検証のみ）。論文プロジェクト・文献1件以上・本文生成済みの節で行う。

- [ ] **Step 1: ピッカー表示条件** — 論文＋文献登録済みの節で「本文を編集」→ ボタン列に「引用を挿入 ▾」が出る。文献0件、または非論文（例: 翻訳）では出ない。
- [ ] **Step 2: カーソル位置に挿入** — textarea 本文の途中にキャレットを置く（クリック）→「引用を挿入」→ 文献を選ぶ →「その位置」に `authorYearMarker`（例 `〔Devlin, 2019〕`）が入り、末尾追記でなくキャレット位置に挿入される。★（節紐付け）が上に並ぶ。
- [ ] **Step 3: selectionStart 保持** — 本文中ほどを選択/クリックしてからボタンを押しても、挿入位置が先頭0でなく保持した位置になる（`onMouseDown preventDefault` と `bodySel` 保持の確認）。
- [ ] **Step 4: 保存と整合** — 挿入後「保存」→ `SectionDraft.body` に挿入マーカーが残る。論文なので保存で自動保護（`locked=true`）される（PR-A の挙動）。挿入マーカーは正準形なので `citation-check`・Word出力のスタイル変換にそのまま乗る（別途改修不要・ここでは body に正しく入ることを確認）。
- [ ] **Step 5: 非論文で非表示** — 翻訳プロジェクトの訳文編集では「引用を挿入」が出ない（スコープ外）。
- [ ] **Step 6: console エラーなし**（`read_console_messages` onlyErrors）。不具合は Task 1 に戻す。

---

## 非スコープ（今回やらない・明記）

- **脚注モード**（Chicago ノート式／和文脚注）は **PR-B3**（別設計書）。`citationStyle` の型追加・`citation.ts` フォーマッタ・`docx.ts` の脚注出力分岐・`citation-check` 波及は本PRでは触らない。
- 挿入するマーカーは常に `authorYearMarker`（スタイル非依存）。番号[n]やMLA形への「挿入時」変換はしない（Word出力時に既存パイプラインが変換）。
- ページ番号つき引用（`〔著者, 年, p.12〕`）は非対応。
- 翻訳モードの訳文エディタへのピッカーは付けない。

## Self-Review（スペック突合）

- **挿入ピッカー（論文・文献1件以上でのみ表示）** → Task 1 Step 3 ✅
- **カーソル位置に `authorYearMarker` を挿入（スタイル非依存）** → Task 1 Step 2/3 ✅
- **selectionStart 消失対策（onSelect保持＋onMouseDown preventDefault）** → Task 1 Step 2/3 ✅
- **節紐付け文献を上に（PR-B1 連携）** → Task 1 Step 3（`referenceIds` でソート・★表示）✅
- **保存はPR-A流用・整合は既存パイプライン** → Task 1（handleSaveBody 変更なし）＋ Task 2 Step 4 ✅
- **脚注は非スコープ（PR-B3）** → 非スコープ節に明記 ✅

Placeholder スキャン: 曖昧語なし・全コードブロック実体あり。型整合: `bodyTextareaRef`/`citePickerOpen`/`bodySel`/`insertCitation`/`rememberBodySel` は Task 内で一貫。CSS クラス `nav-dropdown`/`nav-dropdown-menu`/`nav-dropdown-item` は既存（Nav で使用）。
