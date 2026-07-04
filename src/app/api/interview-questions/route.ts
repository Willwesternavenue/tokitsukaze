import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { AIConfigError } from "@/lib/ai";
import { interviewQuestionsWorkflow, type InterviewQuestionsInput } from "@/workflows/interview";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: InterviewQuestionsInput;
  try {
    body = (await req.json()) as InterviewQuestionsInput;
  } catch {
    return NextResponse.json({ error: "リクエスト本文が不正です。" }, { status: 400 });
  }

  if (!body?.project?.interviewNotes?.trim()) {
    return NextResponse.json({ error: "素材が空です。" }, { status: 400 });
  }

  try {
    const run = await start(interviewQuestionsWorkflow, [body]);
    const result = await run.returnValue;
    if (!result.ok) {
      return NextResponse.json({ error: result.error, runId: result.meta.runId }, { status: 502 });
    }
    return NextResponse.json({ questions: result.questions, runId: result.meta.runId });
  } catch (e) {
    if (e instanceof AIConfigError) {
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[interview-questions] workflow error", msg);
    return NextResponse.json({ error: `AI呼び出しに失敗しました：${msg}` }, { status: 500 });
  }
}
