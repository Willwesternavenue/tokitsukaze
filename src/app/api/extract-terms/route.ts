import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { AIConfigError } from "@/lib/ai";
import { extractTermsWorkflow, type TermsWorkflowInput } from "@/workflows/terms";

export const runtime = "nodejs";

/**
 * 翻訳書モード: 対訳表の候補抽出。
 * ingest-reference と同じく、ワークフローを起動して完了まで待って返す
 * （1回のAI呼び出しで済み、対象文字数もクライアント側で絞っているため同期でよい）。
 */
export async function POST(req: Request) {
  let body: TermsWorkflowInput;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "リクエストの解釈に失敗しました。" }, { status: 400 });
  }
  if (!Array.isArray(body?.pairs) || body.pairs.length === 0) {
    return NextResponse.json(
      { error: "抽出対象の原文・訳文ペアがありません。先にセグメントを翻訳してください。" },
      { status: 400 },
    );
  }

  try {
    const run = await start(extractTermsWorkflow, [
      {
        pairs: body.pairs.slice(0, 8),
        existingTerms: Array.isArray(body.existingTerms) ? body.existingTerms : [],
      },
    ]);
    const result = await run.returnValue;
    if (!result.ok) {
      return NextResponse.json({ error: result.error, runId: result.meta.runId }, { status: 502 });
    }
    return NextResponse.json({ terms: result.terms, runId: result.meta.runId });
  } catch (e) {
    if (e instanceof AIConfigError) {
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[extract-terms] workflow error", msg);
    return NextResponse.json({ error: `用語抽出に失敗しました：${msg}` }, { status: 500 });
  }
}
