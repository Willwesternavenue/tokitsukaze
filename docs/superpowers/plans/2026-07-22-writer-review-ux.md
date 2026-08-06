# 執筆・レビューUX改善 — 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 行番号ではなく本文中の文字列をアンカーに置換すること。

**Goal:** 執筆に「指示付きの本文再生成」、レビューに「解決する（指摘を指示に節再生成→AI再レビュー判定）」「解決済み（全カード共通の手動マーク）」、執筆画面のヘッダー固定＋章・小見出し独立スクロールを入れる。

**Architecture:** A と「解決する」は「指示を添えて本文を再生成」という同じ処理を共有する。`DraftWorkflowInput` に `instruction?` を足し `draftStep` でプロンプトに注入、`startSectionDraft(...instruction?)` で末端まで流す（API は body 透過）。解決判定は既存の再生成→再レビュー突合に委ねる。解決済みは `dismissedFindings` と同型の `resolvedFindings`。レイアウトは CSS のみ。

**Tech Stack:** Next.js 14 / TypeScript / Vercel Workflow / localStorage / CSS。

## Global Constraints

- **テストランナーは無い**。検証は `npx tsc --noEmit`、`npx next build`、純粋/型は目視＋scratchpad、UI/挙動はブラウザ実機（送信ペイロードは `read_network_requests`）。
- **tsc/build は Node 24**: 各コマンド前に `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24.15.0 >/dev/null`。build 成功＝`✓ Generating static pages`。
- **コミット**: `git -c user.name="Will" -c user.email="tachiiri@westernavenu.com" commit`、本文末尾 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。
- **既存挙動不変が最重要**：`instruction` 未指定時の再生成・翻訳の再翻訳・PR-A 手動編集/ロック・PR-B2/B4 引用・対応不要(Ignore) は従来どおり。
- **解決する = 節ごと作り直し（①）**：指摘の `message` を指示にして該当節を再生成。部分修正はしない。**1指摘単位**。
- **解決済み**：`resolvedFindings`（`dismissedFindings` と同型・別枠）。「対応不要」とは独立。トリアージの全 finding カードに付ける。
- **レイアウト**：ヘッダー(`.topbar`)＋ナビ(`.nav`)を sticky 固定。執筆の `.toc`（章・小見出し）は sticky＋独立スクロール。≤980px の1カラムでは従来の縦スクロールに戻す。
- **文字列アンカー必須**。行番号は参考値。

---

## Task 1: 共通土台 — 指示を本文再生成に注入

**Files:** Modify `src/workflows/draft.ts`、`src/lib/translationClient.ts`

**Interfaces:**
- Produces: `DraftWorkflowInput.instruction?: string`、`startSectionDraft(baseProject, chapter, section, instruction?): Promise<string>`（Task 2・4 が consume）。

- [ ] **Step 0: 裏取り**
Run:
- `grep -n 'export type DraftWorkflowInput' src/workflows/draft.ts` → 1件。
- `grep -n 'const systemPromptFinal' src/workflows/draft.ts` → 1件（:223 付近）。
- `grep -n 'export async function startSectionDraft' src/lib/translationClient.ts` → 1件。

- [ ] **Step 1: `DraftWorkflowInput` に instruction を追加**

`src/workflows/draft.ts` の型を検索して置換:

置換前:
```ts
  /** 参照ライブラリで選択された作品カルテ（クライアントから渡す。空なら参照エージェントは走らない） */
  referenceWorks?: ReferenceWork[];
};
```
置換後:
```ts
  /** 参照ライブラリで選択された作品カルテ（クライアントから渡す。空なら参照エージェントは走らない） */
  referenceWorks?: ReferenceWork[];
  /** 再生成時の編集者指示（A の指示欄／レビューの「解決する」）。空/未指定なら従来どおり */
  instruction?: string;
};
```

- [ ] **Step 2: `draftStep` でプロンプトに指示ブロックを注入**

`const systemPromptFinal =` のブロックを検索して置換:

置換前:
```ts
  const systemPromptFinal =
    tpl.systemPrompt +
    (genreContext ? `\n\n${genreContext}` : "") +
    (refContext ? `\n\n${refContext}` : "");
```
置換後:
```ts
  const instructionBlock = input.instruction?.trim()
    ? `\n\n【この節への修正指示】\n${input.instruction.trim()}\n上記の指示を最優先で反映して本文を書き直すこと（指示に関係しない箇所は保持）。`
    : "";
  const systemPromptFinal =
    tpl.systemPrompt +
    (genreContext ? `\n\n${genreContext}` : "") +
    (refContext ? `\n\n${refContext}` : "") +
    instructionBlock;
```

- [ ] **Step 3: `startSectionDraft` に instruction 引数を追加**

`src/lib/translationClient.ts` を検索して置換:

置換前:
```ts
export async function startSectionDraft(
  baseProject: Project,
  chapter: Chapter,
  section: Section,
): Promise<string> {
```
置換後:
```ts
export async function startSectionDraft(
  baseProject: Project,
  chapter: Chapter,
  section: Section,
  instruction?: string,
): Promise<string> {
```

- [ ] **Step 4: postJson の body に instruction を載せる**

同ファイルを検索して置換:

置換前:
```ts
    promptTemplate,
    referenceWorks: getSelectedReferenceWorks(baseProject),
  });
```
置換後:
```ts
    promptTemplate,
    referenceWorks: getSelectedReferenceWorks(baseProject),
    instruction,
  });
```

- [ ] **Step 5: 型チェック＋ビルド**
Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24.15.0 >/dev/null; npx tsc --noEmit && npx next build 2>&1 | grep -iE "Failed|error:|✓ Generating"`
Expected: エラーなし・`✓ Generating`。（`instruction` を渡さない既存呼び出しは optional なので無傷。）

- [ ] **Step 6: コミット**
```bash
git add src/workflows/draft.ts src/lib/translationClient.ts
git -c user.name="Will" -c user.email="tachiiri@westernavenu.com" commit -m "$(printf 'feat: 本文再生成に編集者指示(instruction)を注入する共通土台\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 2: A — 執筆画面の指示付き再生成

**Files:** Modify `src/app/writer/page.tsx`

**Interfaces:** Consumes `startSectionDraft(..., instruction?)`（Task 1）。

- [ ] **Step 0: 裏取り**
Run:
- `grep -c 'async function handleGenerate' src/app/writer/page.tsx` → 1。
- `grep -c 'const runId = await startSectionDraft(project, chapter, section);' src/app/writer/page.tsx` → 1（呼び出しアンカー）。
- `grep -c 'const \[bodyDraft, setBodyDraft\] = useState' src/app/writer/page.tsx` → 1（state 追加アンカー）。
- `grep -c '{isTranslation ? "再翻訳" : "本文を再生成"}' src/app/writer/page.tsx` → 1（ボタンアンカー）。

- [ ] **Step 1: state を追加**

`const [bodyDraft, setBodyDraft] = useState("");` を検索し、その直後に追加:
```tsx
  const [regenInstruction, setRegenInstruction] = useState("");
```

- [ ] **Step 2: `handleGenerate` で指示を渡してクリアする**

`const runId = await startSectionDraft(project, chapter, section);` を検索して置換:

置換前:
```tsx
      const runId = await startSectionDraft(project, chapter, section);
```
置換後:
```tsx
      // 再生成（force）かつ非翻訳のときだけ指示欄を反映する（初回生成・翻訳には無関係）
      const instruction =
        force && !isTranslation ? regenInstruction.trim() || undefined : undefined;
      const runId = await startSectionDraft(project, chapter, section, instruction);
      if (instruction) setRegenInstruction("");
```

- [ ] **Step 3: 指示入力欄を「本文を再生成」ボタンの前に追加**

再生成ボタンのブロックを検索して置換（`{isTranslation ? "再翻訳" : "本文を再生成"}` を含むボタン。非翻訳・生成済み・非編集中のときだけ入力欄を出す）:

置換前:
```tsx
                    {currentDraft ? (
                      <button
                        className="btn"
                        onClick={() => handleGenerate(true)}
                        disabled={loading || batch?.running}
                        type="button"
                      >
                        {loading ? <span className="spinner" /> : null}
                        {isTranslation ? "再翻訳" : "本文を再生成"}
                      </button>
```
置換後:
```tsx
                    {currentDraft && !isTranslation && !editingBody ? (
                      <input
                        className="input"
                        type="text"
                        value={regenInstruction}
                        onChange={(e) => setRegenInstruction(e.target.value)}
                        placeholder="再生成の指示（例: もっと具体例を / 説明を短く）"
                        disabled={loading || batch?.running}
                        style={{ flex: 1, minWidth: 220 }}
                        title="指示を書いて「本文を再生成」を押すと、その指示を反映して作り直します（空なら従来どおり）"
                      />
                    ) : null}
                    {currentDraft ? (
                      <button
                        className="btn"
                        onClick={() => handleGenerate(true)}
                        disabled={loading || batch?.running}
                        type="button"
                      >
                        {loading ? <span className="spinner" /> : null}
                        {isTranslation ? "再翻訳" : "本文を再生成"}
                      </button>
```

- [ ] **Step 4: 型チェック＋ビルド**
Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24.15.0 >/dev/null; npx tsc --noEmit && npx next build 2>&1 | grep -iE "Failed|error:|✓ Generating"`
Expected: エラーなし・`✓ Generating`。

- [ ] **Step 5: コミット**
```bash
git add src/app/writer/page.tsx
git -c user.name="Will" -c user.email="tachiiri@westernavenu.com" commit -m "$(printf 'feat: 本文を再生成に指示欄を追加（論文・聞き書き等の非翻訳・指示付きで作り直す）\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 3: 解決済み — 全カード共通の手動マーク

**Files:** Modify `src/lib/types.ts`、`src/lib/storage.ts`、`src/app/review/page.tsx`

**Interfaces:**
- Produces: `Project.resolvedFindings?: string[]`、`setFindingResolved(id, resolved): Project`（review が consume）。

- [ ] **Step 0: 裏取り**
Run:
- `grep -n 'dismissedFindings' src/lib/types.ts` → Project 型に `dismissedFindings?: string[]` がある（この直後に追加）。
- `grep -n 'export function setFindingDismissed' src/lib/storage.ts` → 1件（直後に足す）。
- `grep -n 'dismissedFindings: Array.isArray' src/lib/storage.ts` → mergeDefaults の補完箇所。
- `grep -n 'const dismissedSet = useMemo' src/app/review/page.tsx` → 1件。
- `grep -c 'onClick={() => dismiss(f.id, true)}' src/app/review/page.tsx` → 1（トリアージの対応不要ボタン）。

- [ ] **Step 1: `Project` 型に resolvedFindings を追加**

`src/lib/types.ts` の `dismissedFindings` 行を検索して置換（実際の宣言に合わせる。`dismissedFindings?: string[];` を含む1行の直後に足す）:

置換前:
```ts
  dismissedFindings?: string[];
```
置換後:
```ts
  dismissedFindings?: string[];
  /** 「解決済み」にした指摘の安定ID（節key|agent|message|loc）。open から除外される。dismissed とは別枠 */
  resolvedFindings?: string[];
```

- [ ] **Step 2: `mergeDefaults` に resolvedFindings 補完を追加**

`src/lib/storage.ts` の mergeDefaults を検索して置換:

置換前:
```ts
    dismissedFindings: Array.isArray((p as any).dismissedFindings)
      ? (p as any).dismissedFindings
      : [],
```
置換後:
```ts
    dismissedFindings: Array.isArray((p as any).dismissedFindings)
      ? (p as any).dismissedFindings
      : [],
    resolvedFindings: Array.isArray((p as any).resolvedFindings)
      ? (p as any).resolvedFindings
      : [],
```

- [ ] **Step 3: `setFindingResolved` を追加**

`export function setFindingDismissed(` のブロック（`}` まで）を検索し、その直後に追加:

`setFindingDismissed` 関数の閉じ `}` の直後に:
```ts

/** 指摘の「解決済み」を切り替える。id は安定ID（節key|agent|message|loc）。dismissed とは別枠 */
export function setFindingResolved(id: string, resolved: boolean): Project {
  return updateProject((p) => {
    const set = new Set(p.resolvedFindings ?? []);
    if (resolved) set.add(id);
    else set.delete(id);
    return { ...p, resolvedFindings: [...set] };
  });
}
```
（アンカー：`return { ...p, dismissedFindings: [...set] };\n  });\n}` の直後に上記を挿入する。）

- [ ] **Step 4: review 画面で resolved を除外＋トグルを追加**

(4a) import に `setFindingResolved` を足す。検索して置換:
置換前:
```ts
import { loadProject, setFindingDismissed } from "@/lib/storage";
```
置換後:
```ts
import { loadProject, setFindingDismissed, setFindingResolved } from "@/lib/storage";
```

(4b) `dismissedSet`/`activeFindings` の useMemo を検索して置換（resolvedSet を足し、activeFindings から resolved も除外、resolvedFindings 一覧を作る）:
置換前:
```ts
  const dismissedSet = useMemo(
    () => new Set(project?.dismissedFindings ?? []),
    [project],
  );
  const activeFindings = useMemo(
    () => flatFindings.filter((f) => !dismissedSet.has(f.id)),
    [flatFindings, dismissedSet],
  );
```
置換後:
```ts
  const dismissedSet = useMemo(
    () => new Set(project?.dismissedFindings ?? []),
    [project],
  );
  const resolvedSet = useMemo(
    () => new Set(project?.resolvedFindings ?? []),
    [project],
  );
  const activeFindings = useMemo(
    () => flatFindings.filter((f) => !dismissedSet.has(f.id) && !resolvedSet.has(f.id)),
    [flatFindings, dismissedSet, resolvedSet],
  );
  const resolvedList = useMemo(
    () => flatFindings.filter((f) => resolvedSet.has(f.id)),
    [flatFindings, resolvedSet],
  );
```

(4c) `dismiss` 関数の直後に `resolve` を足す。検索して置換:
置換前:
```ts
  function dismiss(id: string, on: boolean) {
    setProject(setFindingDismissed(id, on));
  }
```
置換後:
```ts
  function dismiss(id: string, on: boolean) {
    setProject(setFindingDismissed(id, on));
  }

  function resolve(id: string, on: boolean) {
    setProject(setFindingResolved(id, on));
  }
```

(4d) トリアージの各カードに「解決済み」ボタンを追加。対応不要ボタンを検索して置換:
置換前:
```tsx
                          <button
                            type="button"
                            className="btn sm ghost"
                            title="この指摘を対応不要にする（トリアージから外す）"
                            onClick={() => dismiss(f.id, true)}
                          >
                            対応不要
                          </button>
```
置換後:
```tsx
                          <button
                            type="button"
                            className="btn sm"
                            title="解決済みにする（このカードを消す。AI判定の補助・上書き）"
                            onClick={() => resolve(f.id, true)}
                          >
                            解決済み
                          </button>
                          <button
                            type="button"
                            className="btn sm ghost"
                            title="この指摘を対応不要にする（トリアージから外す）"
                            onClick={() => dismiss(f.id, true)}
                          >
                            対応不要
                          </button>
```

(4e) 解決済み一覧（復帰用）を「無視した指摘」details の直前に追加。検索して置換:
置換前:
```tsx
                {dismissedFindings.length > 0 ? (
                  <details className="dismissed-block" style={{ marginTop: 12 }}>
                    <summary>無視した指摘（{dismissedFindings.length}）</summary>
```
置換後:
```tsx
                {resolvedList.length > 0 ? (
                  <details className="dismissed-block" style={{ marginTop: 12 }}>
                    <summary>解決済みの指摘（{resolvedList.length}）</summary>
                    <ul className="list-block" style={{ marginTop: 8 }}>
                      {resolvedList.map((f) => (
                        <li key={f.id} className="triage-item" style={{ opacity: 0.7 }}>
                          <span className="badge gray">{TIER_LABEL[f.tier]}</span>
                          <div style={{ flex: 1 }}>
                            <div className="finding-message">{f.message}</div>
                            <div className="muted" style={{ fontSize: 11 }}>
                              {f.agentLabel} ・ {f.chapterTitle} ／ {f.sectionTitle}
                            </div>
                          </div>
                          <button type="button" className="btn sm" onClick={() => resolve(f.id, false)}>
                            戻す
                          </button>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
                {dismissedFindings.length > 0 ? (
                  <details className="dismissed-block" style={{ marginTop: 12 }}>
                    <summary>無視した指摘（{dismissedFindings.length}）</summary>
```

- [ ] **Step 5: 型チェック＋ビルド**
Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24.15.0 >/dev/null; npx tsc --noEmit && npx next build 2>&1 | grep -iE "Failed|error:|✓ Generating"`
Expected: エラーなし・`✓ Generating`。

- [ ] **Step 6: コミット**
```bash
git add src/lib/types.ts src/lib/storage.ts src/app/review/page.tsx
git -c user.name="Will" -c user.email="tachiiri@westernavenu.com" commit -m "$(printf 'feat: レビューに「解決済み」手動マーク（全カード・dismissedとは別枠のresolvedFindings）\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 4: 解決する — 指摘を指示に節を再生成

**Files:** Modify `src/app/review/page.tsx`

**Interfaces:** Consumes `startSectionDraft(..., instruction?)`（Task 1）、`finishSectionDraft`（既存）、Task 3 の resolve 周辺。

- [ ] **Step 0: 裏取り**
Run:
- `grep -n 'FlatFinding' src/app/review/page.tsx | head` → 型定義と生成箇所（:139 付近）。
- `grep -n "id: \`\${s.key}|\${r.agent}" src/app/review/page.tsx` → FlatFinding 生成（s.key を持つ）。
- `grep -n 'from "@/lib/translationClient"' src/app/review/page.tsx` → 既存 import 有無（無ければ追加）。
- `grep -n 'selectedOutline' src/app/review/page.tsx` → project.selectedOutline から章・節を辿れることを確認。

- [ ] **Step 1: import と state を追加**

(1a) `startSectionDraft`/`finishSectionDraft` を import（`@/lib/translationClient`）。ファイル冒頭の import 群に追加:
```ts
import { startSectionDraft, finishSectionDraft } from "@/lib/translationClient";
```

(1b) FlatFinding 型に `chapterId`/`sectionId` を追加。`type FlatFinding` の宣言を検索し、フィールドに以下を足す（`chapterNumber: number;` の隣）:
```ts
  chapterId: string;
  sectionId: string;
```
（`s.key` は `${chapterId}::${sectionId}`。FlatFinding 生成時に `const [chapterId, sectionId] = s.key.split("::");` で取り出して詰める。）

(1c) FlatFinding 生成箇所（`id: \`${s.key}|...\``）に chapterId/sectionId を足す。`out.push({` のオブジェクトに追加（生成ループ内で `const [chapterId, sectionId] = s.key.split("::");` を宣言してから）:
```ts
            chapterId,
            sectionId,
```

(1d) 実行中スピナー用 state を、`resolve` 関数の近く（コンポーネント内 state 群）に追加:
```tsx
  const [resolvingId, setResolvingId] = useState<string | null>(null);
```

- [ ] **Step 2: 「解決する」ハンドラを追加**

`function resolve(id: string, on: boolean) {`（Task 3 で追加）の直後に追加:
```tsx
  // 「解決する」: その指摘を指示にして該当節を再生成し、再レビュー結果で解決を判定させる
  async function resolveByRegen(f: FlatFinding) {
    if (!project || resolvingId) return;
    const outline = project.selectedOutline;
    const chapter = outline?.chapters.find((c) => c.id === f.chapterId);
    const section = chapter?.sections.find((s) => s.id === f.sectionId);
    if (!chapter || !section) {
      alert("対象の節が見つかりませんでした（構成が変更された可能性）。");
      return;
    }
    setResolvingId(f.id);
    try {
      const instruction = `次のレビュー指摘に対応して、この節の本文を直してください：「${f.message}」${
        f.loc ? `（該当箇所: ${f.loc}）` : ""
      }`;
      const runId = await startSectionDraft(project, chapter, section, instruction);
      const next = await finishSectionDraft(runId);
      setProject(next);
      // 再レビュー結果は next に反映済み。指摘が再度出なければ activeFindings から自然に消える。
    } catch (e) {
      alert("解決（再生成）に失敗しました：" + (e instanceof Error ? e.message : String(e)));
    } finally {
      setResolvingId(null);
    }
  }
```

- [ ] **Step 3: 「解決する」ボタンをトリアージカードに追加**

Task 3 で入れた「解決済み」ボタンの直前に「解決する」ボタンを足す。検索して置換:

置換前:
```tsx
                          <button
                            type="button"
                            className="btn sm"
                            title="解決済みにする（このカードを消す。AI判定の補助・上書き）"
                            onClick={() => resolve(f.id, true)}
                          >
                            解決済み
                          </button>
```
置換後:
```tsx
                          <button
                            type="button"
                            className="btn sm primary"
                            title="この指摘を指示にして該当節を再生成し、AIの再レビューで解決を判定します"
                            disabled={!!resolvingId}
                            onClick={() => resolveByRegen(f)}
                          >
                            {resolvingId === f.id ? <span className="spinner" /> : null}
                            解決する
                          </button>
                          <button
                            type="button"
                            className="btn sm"
                            title="解決済みにする（このカードを消す。AI判定の補助・上書き）"
                            onClick={() => resolve(f.id, true)}
                          >
                            解決済み
                          </button>
```

- [ ] **Step 4: 型チェック＋ビルド**
Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24.15.0 >/dev/null; npx tsc --noEmit && npx next build 2>&1 | grep -iE "Failed|error:|✓ Generating"`
Expected: エラーなし・`✓ Generating`。

- [ ] **Step 5: コミット**
```bash
git add src/app/review/page.tsx
git -c user.name="Will" -c user.email="tachiiri@westernavenu.com" commit -m "$(printf 'feat: レビューに「解決する」＝指摘を指示に該当節を再生成→AI再レビューで解決判定\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 5: C — 執筆レイアウト（ヘッダー固定＋章・小見出し独立スクロール）

**Files:** Modify `src/app/globals.css`

- [ ] **Step 0: 裏取り**
Run:
- `grep -n '^.topbar {' src/app/globals.css` → :74。
- `grep -n '^.nav {' src/app/globals.css` → :226。
- `grep -n '^.writer-shell {' src/app/globals.css` → :419。
- `grep -n '^.toc {' src/app/globals.css` → :630。

- [ ] **Step 1: topbar を sticky 固定**

`.topbar {` ブロックの `box-shadow: var(--shadow);` を検索して置換:
置換前:
```css
  height: 48px;
  box-shadow: var(--shadow);
}
```
置換後:
```css
  height: 48px;
  box-shadow: var(--shadow);
  position: sticky;
  top: 0;
  z-index: 30;
}
```

- [ ] **Step 2: nav を sticky 固定（topbar の直下に張り付く）**

`.nav {` ブロックの末尾 `position: relative;` を検索して置換（sticky は relative 同様、絶対配置ドロップダウンの包含ブロックになる）:
置換前:
```css
  /* overflow-x: auto を使うと、絶対配置のドロップダウン (ナレッジ▾) が
     クリップされて見えなくなるため、折り返しで対応する */
  position: relative;
}
```
置換後:
```css
  /* overflow-x: auto を使うと、絶対配置のドロップダウン (ナレッジ▾) が
     クリップされて見えなくなるため、折り返しで対応する */
  position: sticky;
  top: 48px; /* topbar の高さ分だけ下げて張り付く */
  z-index: 20;
}
```

- [ ] **Step 3: 章・小見出し（.toc）を独立スクロールにする**

`.toc {` ブロックを検索して置換（既存プロパティは残し、sticky＋max-height＋overflow を足す）:
置換前:
```css
.toc {
```
置換後:
```css
.toc {
  /* 執筆画面: ヘッダー(topbar48+nav約40=約88px)の下に張り付き、章・小見出しだけを
     独立して上下スクロールさせる。ページや右カラム（本文）は動かさない。 */
  position: sticky;
  top: 96px;
  align-self: start;
  max-height: calc(100vh - 104px);
  overflow-y: auto;
```

- [ ] **Step 4: 狭幅（1カラム）では独立スクロールを解除**

`@media (max-width: 980px)` の `.writer-shell` ブロックを検索して置換（同メディア内で `.toc` を従来の縦スクロールに戻す）:
置換前:
```css
@media (max-width: 980px) {
  .writer-shell {
    grid-template-columns: 1fr;
  }
}
```
置換後:
```css
@media (max-width: 980px) {
  .writer-shell {
    grid-template-columns: 1fr;
  }
  .toc {
    position: static;
    max-height: none;
    overflow-y: visible;
  }
}
```

- [ ] **Step 5: 型チェック＋ビルド**
Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24.15.0 >/dev/null; npx tsc --noEmit && npx next build 2>&1 | grep -iE "Failed|error:|✓ Generating"`
Expected: エラーなし・`✓ Generating`。

- [ ] **Step 6: コミット**
```bash
git add src/app/globals.css
git -c user.name="Will" -c user.email="tachiiri@westernavenu.com" commit -m "$(printf 'fix: 執筆画面のヘッダー/ナビを固定し、章・小見出しを独立スクロールに\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 6: 実機検証（コントローラ）

**Files:** 変更なし。不具合は該当 Task に戻す。

- [ ] **Step 1: A 指示付き再生成**：論文/聞き書きの節で指示を入れて「本文を再生成」→ `read_network_requests`（urlPattern: `generate-draft`）で body に `instruction`（入力値）が載る。空欄なら `instruction` は undefined。翻訳では指示欄が出ない。実生成の文体反映は本番（ローカルにAIキーが無いため送信内容で検証）。
- [ ] **Step 2: 解決済み**：レビュー→トリアージの任意カードで「解決済み」→ カードが消え `localStorage` の `resolvedFindings` に id が入る。「解決済みの指摘」から「戻す」で復帰。対応不要とは独立（片方が他方に影響しない）。リロードで永続。console エラー0。
- [ ] **Step 3: 解決する**：カードの「解決する」→ 該当節が再生成される（`generate-draft` の body に `instruction`＝指摘文が載る）。実行中スピナー・二重押下防止。成功後、その指摘が再レビューで消えればカード消滅（AIキー無しで実生成が失敗しても、送信内容と経路を検証）。
- [ ] **Step 4: C レイアウト**：執筆画面で章・小見出しを増やして左をスクロール→ topbar/nav/右本文は固定のまま、左だけスクロール。右本文を長くして右（ページ）スクロールでも topbar/nav が残る。ブラウザ幅を 980px 以下→ 1カラム＆従来の縦スクロールに戻る。ナビの「ナレッジ▾」ドロップダウンが sticky でも正しく開く。他ページのヘッダーが崩れない。
- [ ] **Step 5: 回帰**：指示なしの通常再生成・翻訳の再翻訳・PR-A 手動編集/ロック・PR-B2/B4 引用・対応不要(Ignore) が従来どおり。

---

## Self-Review（スペック突合）

- **① 指示注入（共通土台）**（spec ①）→ Task 1 ✅
- **A 指示付き再生成**（spec A）→ Task 2 ✅
- **解決済み（全カード・resolvedFindings・別枠）**（spec 解決済み）→ Task 3 ✅
- **解決する（1指摘単位・指摘を指示に節再生成・AI再レビュー判定）**（spec 解決する）→ Task 4 ✅
- **C ヘッダー固定＋章小見出し独立スクロール＋狭幅解除**（spec C）→ Task 5 ✅
- **既存挙動不変**（instruction未指定/翻訳/対応不要）→ Task 1 の optional・Task 2 の force&&!isTranslation ガード・Task 3 の別枠 ✅
- 非スコープ（部分修正・一括解決・指示の永続保存・専用判定AI・Ignore変更・他ページ大幅改修）→ 含めない ✅

Placeholder スキャン: 曖昧語なし・全コードブロック実体あり。型整合: `instruction`/`DraftWorkflowInput`/`startSectionDraft`/`resolvedFindings`/`setFindingResolved`/`resolve`/`resolveByRegen`/`FlatFinding.chapterId,sectionId` は Task 間で一貫。Task 4 は Task 1・3 に依存（順序: 1→2→3→4→5）。
