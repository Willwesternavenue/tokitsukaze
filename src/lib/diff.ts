/**
 * 依存なしの軽量Diff（翻訳書モードの「変更差分」ビュー用）。
 * 行単位のLCSで GitHub 風の削除/追加を出し、置換行のペアには文字単位のハイライトを付ける。
 * 想定サイズはセグメント訳文（数千字・数十〜数百行）なので O(n*m) のDPで十分。
 */

export type CharSpan = { type: "same" | "del" | "add"; text: string };

export type DiffLine =
  | { type: "same"; text: string }
  | { type: "del"; text: string; spans?: CharSpan[] }
  | { type: "add"; text: string; spans?: CharSpan[] };

/** 行単位LCS。行数が多すぎる場合は安全側に全置換として返す */
export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = oldText.split("\n");
  const b = newText.split("\n");
  if (a.length * b.length > 400_000) {
    return [
      ...a.map((t): DiffLine => ({ type: "del", text: t })),
      ...b.map((t): DiffLine => ({ type: "add", text: t })),
    ];
  }

  // LCS DP
  const n = a.length;
  const m = b.length;
  const dp: Uint32Array[] = [];
  for (let i = 0; i <= n; i++) dp.push(new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  let pendingDel: string[] = [];
  let pendingAdd: string[] = [];

  const flushPending = () => {
    // 削除と追加が同数のときは「置換」とみなして行ペアごとに文字Diffを付ける
    if (pendingDel.length > 0 && pendingDel.length === pendingAdd.length) {
      for (let k = 0; k < pendingDel.length; k++) {
        const spans = diffChars(pendingDel[k], pendingAdd[k]);
        out.push({ type: "del", text: pendingDel[k], spans: spans?.del });
        out.push({ type: "add", text: pendingAdd[k], spans: spans?.add });
      }
    } else {
      for (const t of pendingDel) out.push({ type: "del", text: t });
      for (const t of pendingAdd) out.push({ type: "add", text: t });
    }
    pendingDel = [];
    pendingAdd = [];
  };

  while (i < n && j < m) {
    if (a[i] === b[j]) {
      flushPending();
      out.push({ type: "same", text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      pendingDel.push(a[i]);
      i++;
    } else {
      pendingAdd.push(b[j]);
      j++;
    }
  }
  while (i < n) pendingDel.push(a[i++]);
  while (j < m) pendingAdd.push(b[j++]);
  flushPending();

  return out;
}

/**
 * 文字単位LCS（置換行ペアのハイライト用）。
 * 長すぎる行はコスト回避のため null を返し、行全体の色分けのみにする。
 */
export function diffChars(
  oldLine: string,
  newLine: string,
): { del: CharSpan[]; add: CharSpan[] } | null {
  const a = Array.from(oldLine);
  const b = Array.from(newLine);
  if (a.length * b.length > 90_000) return null;

  const n = a.length;
  const m = b.length;
  const dp: Uint16Array[] = [];
  for (let i = 0; i <= n; i++) dp.push(new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const del: CharSpan[] = [];
  const add: CharSpan[] = [];
  const push = (arr: CharSpan[], type: CharSpan["type"], ch: string) => {
    const last = arr[arr.length - 1];
    if (last && last.type === type) last.text += ch;
    else arr.push({ type, text: ch });
  };

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push(del, "same", a[i]);
      push(add, "same", b[j]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push(del, "del", a[i]);
      i++;
    } else {
      push(add, "add", b[j]);
      j++;
    }
  }
  while (i < n) push(del, "del", a[i++]);
  while (j < m) push(add, "add", b[j++]);

  return { del, add };
}

/** Diffの統計（追加/削除行数）。ヘッダ表示用 */
export function diffStats(lines: DiffLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const l of lines) {
    if (l.type === "add") added++;
    else if (l.type === "del") removed++;
  }
  return { added, removed };
}
