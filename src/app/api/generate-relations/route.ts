import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { AIConfigError } from "@/lib/ai";
import { relationsWorkflow, type RelationsWorkflowInput } from "@/workflows/relations";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: RelationsWorkflowInput;
  try {
    body = (await req.json()) as RelationsWorkflowInput;
  } catch {
    return NextResponse.json({ error: "リクエスト本文が不正です。" }, { status: 400 });
  }

  const characters = body?.project?.characters ?? [];
  if (characters.length < 2) {
    return NextResponse.json(
      { error: "相関図の生成には登場人物を2名以上登録してください。" },
      { status: 400 },
    );
  }

  try {
    const run = await start(relationsWorkflow, [body]);
    const result = await run.returnValue;
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error ?? "関係の抽出に失敗しました。", runId: result.meta.runId },
        { status: 502 },
      );
    }
    return NextResponse.json({
      relationships: result.relationships,
      runId: result.meta.runId,
    });
  } catch (e) {
    if (e instanceof AIConfigError) {
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[generate-relations] workflow error", msg);
    return NextResponse.json({ error: `AI呼び出しに失敗しました：${msg}` }, { status: 500 });
  }
}
