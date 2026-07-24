import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { AIConfigError } from "@/lib/ai";
import { annotateCitationsWorkflow } from "@/workflows/citationAnnotate";

export const runtime = "nodejs";

/**
 * 論文モード: 既存本文＋登録文献から「引用の差し込み候補（位置＋文献ID）」を返す。
 * 本文は書き換えず、位置決め・挿入はクライアントが planAnnotations/applyAnnotations で行う。
 */
export async function POST(req: Request) {
  let input: unknown;
  try {
    input = await req.json();
  } catch {
    return NextResponse.json({ error: "リクエストの解釈に失敗しました。" }, { status: 400 });
  }
  const o = (input ?? {}) as Record<string, unknown>;
  const body = typeof o.body === "string" ? o.body : "";
  const references = Array.isArray(o.references) ? o.references : [];
  if (!body.trim()) {
    return NextResponse.json({ error: "本文がありません。" }, { status: 400 });
  }
  if (references.length === 0) {
    return NextResponse.json({ error: "参考文献が登録されていません。" }, { status: 400 });
  }

  try {
    const run = await start(annotateCitationsWorkflow, [
      {
        body,
        references,
        field: String(o.field ?? ""),
        researchQuestion: String(o.researchQuestion ?? ""),
      },
    ]);
    const result = await run.returnValue;
    if (!result.ok) {
      return NextResponse.json({ error: result.error, runId: result.meta.runId }, { status: 502 });
    }
    return NextResponse.json({ proposals: result.proposals, runId: result.meta.runId });
  } catch (e) {
    if (e instanceof AIConfigError) {
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[annotate-citations] workflow error", msg);
    return NextResponse.json({ error: `引用候補の生成に失敗しました：${msg}` }, { status: 500 });
  }
}
