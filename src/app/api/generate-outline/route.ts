import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { AIConfigError } from "@/lib/ai";
import { outlineWorkflow, type OutlineWorkflowInput } from "@/workflows/outline";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: OutlineWorkflowInput;
  try {
    body = (await req.json()) as OutlineWorkflowInput;
  } catch {
    return NextResponse.json({ error: "リクエスト本文が不正です。" }, { status: 400 });
  }

  if (!body?.interviewNotes?.trim()) {
    return NextResponse.json({ error: "取材メモが空です。" }, { status: 400 });
  }

  try {
    const run = await start(outlineWorkflow, [body]);
    const result = await run.returnValue;
    if (!result.ok) {
      console.error(
        `[generate-outline] workflow failed (runId=${result.meta.runId}, attempts=${result.meta.attempts})`,
      );
      return NextResponse.json(
        { error: result.error, raw: result.raw, runId: result.meta.runId },
        { status: 502 },
      );
    }
    return NextResponse.json({ proposals: result.proposals, runId: result.meta.runId });
  } catch (e) {
    if (e instanceof AIConfigError) {
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[generate-outline] workflow error", msg);
    return NextResponse.json({ error: `AI呼び出しに失敗しました：${msg}` }, { status: 500 });
  }
}
