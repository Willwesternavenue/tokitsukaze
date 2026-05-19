/**
 * AIが返した文字列から最初のJSONブロックを抽出してparseする。
 * 失敗した場合は null を返す。
 *
 * 対応する崩れ方:
 *   - ```json ... ``` のコードフェンス
 *   - 前後に説明文が付いている
 *   - 末尾にカンマなど軽微なゴミがある場合 (best-effortで除去)
 */
export function safeJsonParse<T = unknown>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const candidates: string[] = [];
  candidates.push(trimmed);

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) candidates.push(fenced[1].trim());

  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first !== -1 && last > first) {
    candidates.push(trimmed.slice(first, last + 1));
  }
  const firstArr = trimmed.indexOf("[");
  const lastArr = trimmed.lastIndexOf("]");
  if (firstArr !== -1 && lastArr > firstArr) {
    candidates.push(trimmed.slice(firstArr, lastArr + 1));
  }

  for (const c of candidates) {
    try {
      return JSON.parse(c) as T;
    } catch {
      // ignore
    }
    try {
      return JSON.parse(c.replace(/,\s*([}\]])/g, "$1")) as T;
    } catch {
      // ignore
    }
  }

  return null;
}
