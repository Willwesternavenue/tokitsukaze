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
    // 非同期実行: runId を即返し、クライアントは /api/workflow-status をポーリングする。
    // これで 1 リクエストの実行時間上限（=504/300s）から切り離され、
    // タブ切替・アプリ内移動・リロードから復帰して結果を回収できる。
    const run = await start(draftWorkflow, [body]);
    return NextResponse.json({ runId: run.runId }, { status: 202 });
  } catch (e) {
    if (e instanceof AIConfigError) {
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[generate-draft] start error", msg);
    return NextResponse.json({ error: `生成の開始に失敗しました：${msg}` }, { status: 500 });
  }
}
