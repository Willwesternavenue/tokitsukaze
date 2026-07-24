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
