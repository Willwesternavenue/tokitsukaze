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
    // 非同期実行: runId を即返し、クライアントは /api/workflow-status をポーリングする。
    const run = await start(sectionsWorkflow, [body]);
    return NextResponse.json({ runId: run.runId }, { status: 202 });
  } catch (e) {
    if (e instanceof AIConfigError) {
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[generate-sections] start error", msg);
    return NextResponse.json({ error: `生成の開始に失敗しました：${msg}` }, { status: 500 });
  }
}
