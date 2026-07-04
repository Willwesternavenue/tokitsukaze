import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { AIConfigError } from "@/lib/ai";
import { refineOutlineWorkflow, type RefineOutlineInput } from "@/workflows/refineOutline";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: RefineOutlineInput;
  try {
    body = (await req.json()) as RefineOutlineInput;
  } catch {
    return NextResponse.json({ error: "リクエスト本文が不正です。" }, { status: 400 });
  }

  if (!body?.outline?.chapters?.length) {
    return NextResponse.json({ error: "構成案がありません。" }, { status: 400 });
  }
  if (!body.instruction?.trim()) {
    return NextResponse.json({ error: "改善の指示を入力してください。" }, { status: 400 });
  }

  try {
    const run = await start(refineOutlineWorkflow, [body]);
    const result = await run.returnValue;
    if (!result.ok) {
      return NextResponse.json({ error: result.error, runId: result.meta.runId }, { status: 502 });
    }
    return NextResponse.json({ outline: result.outline, runId: result.meta.runId });
  } catch (e) {
    if (e instanceof AIConfigError) {
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[refine-outline] workflow error", msg);
    return NextResponse.json({ error: `AI呼び出しに失敗しました：${msg}` }, { status: 500 });
  }
}
