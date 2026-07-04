import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { AIConfigError } from "@/lib/ai";
import { impactWorkflow, type ImpactWorkflowInput } from "@/workflows/impact";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: ImpactWorkflowInput;
  try {
    body = (await req.json()) as ImpactWorkflowInput;
  } catch {
    return NextResponse.json({ error: "リクエスト本文が不正です。" }, { status: 400 });
  }

  if (!body?.project || !body.changedChapterId || !body.changedSectionId) {
    return NextResponse.json({ error: "必要なデータが不足しています。" }, { status: 400 });
  }

  try {
    const run = await start(impactWorkflow, [body]);
    const result = await run.returnValue;
    if (!result.ok) {
      return NextResponse.json({ error: result.error, runId: result.meta.runId }, { status: 502 });
    }
    return NextResponse.json({ items: result.items, runId: result.meta.runId });
  } catch (e) {
    if (e instanceof AIConfigError) {
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[detect-impact] workflow error", msg);
    return NextResponse.json({ error: `AI呼び出しに失敗しました：${msg}` }, { status: 500 });
  }
}
