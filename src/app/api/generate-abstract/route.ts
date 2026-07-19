import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { AIConfigError } from "@/lib/ai";
import { abstractWorkflow, type AbstractInput } from "@/workflows/paperOutput";

export const runtime = "nodejs";

/** 論文モード: 要旨（アブストラクト）とキーワードを生成する。 */
export async function POST(req: Request) {
  let body: AbstractInput;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "リクエストの解釈に失敗しました。" }, { status: 400 });
  }
  if (!body?.summary?.trim()) {
    return NextResponse.json(
      { error: "本文がありません。先に本文を生成してください。" },
      { status: 400 },
    );
  }
  try {
    const run = await start(abstractWorkflow, [body]);
    const result = await run.returnValue;
    if (!result.ok) {
      return NextResponse.json({ error: result.error, runId: result.meta.runId }, { status: 502 });
    }
    return NextResponse.json({ abstract: result.abstract, keywords: result.keywords });
  } catch (e) {
    if (e instanceof AIConfigError) {
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[generate-abstract] error", msg);
    return NextResponse.json({ error: `要旨の生成に失敗しました：${msg}` }, { status: 500 });
  }
}
