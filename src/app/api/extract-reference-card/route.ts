import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { AIConfigError } from "@/lib/ai";
import { extractTextFromFile } from "@/lib/extractFile";
import { extractReferenceCardWorkflow } from "@/workflows/referenceCard";

export const runtime = "nodejs";

/**
 * 論文モード: 文献ファイル（docx/pdf/txt/md）から文献カルテを生成して返す。
 * ファイルは保存せず、抽出テキストから書誌＋カルテをAIが作る（ingest-reference と同じ同期await型）。
 */
export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "ファイルの受信に失敗しました。" }, { status: 400 });
  }

  const file = form.get("file");
  const field = String(form.get("field") ?? "");
  const researchQuestion = String(form.get("researchQuestion") ?? "");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "ファイルが添付されていません。" }, { status: 400 });
  }

  let text: string;
  try {
    text = await extractTextFromFile(file);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `テキスト抽出に失敗しました：${msg}` }, { status: 400 });
  }
  if (!text.trim()) {
    return NextResponse.json(
      { error: "本文テキストが取得できませんでした（画像PDF等の可能性）。" },
      { status: 400 },
    );
  }

  try {
    const run = await start(extractReferenceCardWorkflow, [
      { sourceText: text, field, researchQuestion, sourceFilename: file.name },
    ]);
    const result = await run.returnValue;
    if (!result.ok) {
      return NextResponse.json({ error: result.error, runId: result.meta.runId }, { status: 502 });
    }
    return NextResponse.json({ reference: result.reference, runId: result.meta.runId });
  } catch (e) {
    if (e instanceof AIConfigError) {
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[extract-reference-card] workflow error", msg);
    return NextResponse.json({ error: `文献カルテの生成に失敗しました：${msg}` }, { status: 500 });
  }
}
