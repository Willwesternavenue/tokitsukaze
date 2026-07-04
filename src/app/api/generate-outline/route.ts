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
    // 非同期実行: すぐ runId を返し、クライアントは /api/workflow-status をポーリングする。
    // これで生成が 1 リクエストの実行時間上限（=504）に縛られなくなる。
    const run = await start(outlineWorkflow, [body]);
    return NextResponse.json({ runId: run.runId }, { status: 202 });
  } catch (e) {
    if (e instanceof AIConfigError) {
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[generate-outline] start error", msg);
    return NextResponse.json({ error: `生成の開始に失敗しました：${msg}` }, { status: 500 });
  }
}
