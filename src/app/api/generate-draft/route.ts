import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { AIConfigError } from "@/lib/ai";
import { draftWorkflow, type DraftWorkflowInput } from "@/workflows/draft";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: DraftWorkflowInput;
  try {
    body = (await req.json()) as DraftWorkflowInput;
  } catch {
    return NextResponse.json({ error: "リクエスト本文が不正です。" }, { status: 400 });
  }

  const { project, chapter, section } = body ?? {};
  if (!project || !chapter || !section) {
    return NextResponse.json({ error: "必要なデータが不足しています。" }, { status: 400 });
  }
  if (!project.interviewNotes?.trim()) {
    return NextResponse.json({ error: "取材メモが空です。" }, { status: 400 });
  }

  try {
    const run = await start(draftWorkflow, [body]);
    const result = await run.returnValue;
    return NextResponse.json({
      draft: result.draft,
      parseFailed: result.parseFailed ?? false,
      runId: result.meta.runId,
      agentReports: result.agentReports ?? [],
    });
  } catch (e) {
    if (e instanceof AIConfigError) {
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[generate-draft] workflow error", msg);
    return NextResponse.json({ error: `AI呼び出しに失敗しました：${msg}` }, { status: 500 });
  }
}
