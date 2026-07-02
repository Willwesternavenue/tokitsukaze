import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { AIConfigError } from "@/lib/ai";
import { sectionsWorkflow, type SectionsWorkflowInput } from "@/workflows/sections";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: SectionsWorkflowInput;
  try {
    body = (await req.json()) as SectionsWorkflowInput;
  } catch {
    return NextResponse.json({ error: "リクエスト本文が不正です。" }, { status: 400 });
  }

  if (!body?.selectedOutline?.chapters?.length) {
    return NextResponse.json({ error: "選択された構成案がありません。" }, { status: 400 });
  }

  try {
    const run = await start(sectionsWorkflow, [body]);
    const result = await run.returnValue;
    if (!result.ok) {
      console.error(
        `[generate-sections] workflow parseFailed (runId=${result.meta.runId}, attempts=${result.meta.attempts})`,
      );
      return NextResponse.json({
        outline: result.outline,
        parseFailed: true,
        raw: result.raw,
        runId: result.meta.runId,
      });
    }
    return NextResponse.json({ outline: result.outline, runId: result.meta.runId });
  } catch (e) {
    if (e instanceof AIConfigError) {
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[generate-sections] workflow error", msg);
    return NextResponse.json({ error: `AI呼び出しに失敗しました：${msg}` }, { status: 500 });
  }
}
