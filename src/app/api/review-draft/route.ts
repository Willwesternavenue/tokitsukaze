import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { AIConfigError } from "@/lib/ai";
import { reviewWorkflow, type ReviewWorkflowInput } from "@/workflows/review";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: ReviewWorkflowInput;
  try {
    body = (await req.json()) as ReviewWorkflowInput;
  } catch {
    return NextResponse.json({ error: "リクエスト本文が不正です。" }, { status: 400 });
  }

  if (!body?.draft?.body?.trim()) {
    return NextResponse.json({ error: "レビュー対象の本文がありません。" }, { status: 400 });
  }

  try {
    const run = await start(reviewWorkflow, [body]);
    const result = await run.returnValue;
    return NextResponse.json({
      editorNotes: result.editorNotes,
      followUpQuestions: result.followUpQuestions,
      factCheckPoints: result.factCheckPoints,
      revisionSuggestions: result.revisionSuggestions,
      parseFailed: result.parseFailed ?? false,
      runId: result.meta.runId,
    });
  } catch (e) {
    if (e instanceof AIConfigError) {
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[review-draft] workflow error", msg);
    return NextResponse.json({ error: `AI呼び出しに失敗しました：${msg}` }, { status: 500 });
  }
}
