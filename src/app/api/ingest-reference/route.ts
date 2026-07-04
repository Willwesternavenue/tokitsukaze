import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { AIConfigError } from "@/lib/ai";
import { analyzeReferenceWorkflow } from "@/workflows/reference";

export const runtime = "nodejs";

// アップロードファイルからプレーンテキストを抽出する
async function extractText(file: File): Promise<string> {
  const name = (file.name || "").toLowerCase();
  const buf = Buffer.from(await file.arrayBuffer());

  if (name.endsWith(".docx")) {
    const mammoth = await import("mammoth");
    const res = await mammoth.extractRawText({ buffer: buf });
    return res.value ?? "";
  }
  if (name.endsWith(".pdf")) {
    const { extractText: pdfExtract, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await pdfExtract(pdf, { mergePages: true });
    return Array.isArray(text) ? text.join("\n") : text ?? "";
  }
  if (name.endsWith(".txt") || name.endsWith(".md")) {
    return buf.toString("utf-8");
  }
  throw new Error("対応形式は .docx / .pdf / .txt / .md です。");
}

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "ファイルの受信に失敗しました。" }, { status: 400 });
  }

  const file = form.get("file");
  const title = String(form.get("title") ?? "").trim();
  const kind = String(form.get("kind") ?? "own") === "reference" ? "reference" : "own";
  const isFiction = String(form.get("isFiction") ?? "false") === "true";

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "ファイルが添付されていません。" }, { status: 400 });
  }

  let text: string;
  try {
    text = await extractText(file);
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
    const run = await start(analyzeReferenceWorkflow, [
      {
        title: title || file.name || "無題の作品",
        kind: kind as "own" | "reference",
        isFiction,
        sourceFilename: file.name,
        text,
      },
    ]);
    const result = await run.returnValue;
    if (!result.ok) {
      return NextResponse.json({ error: result.error, runId: result.meta.runId }, { status: 502 });
    }
    return NextResponse.json({ work: result.work, runId: result.meta.runId });
  } catch (e) {
    if (e instanceof AIConfigError) {
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[ingest-reference] workflow error", msg);
    return NextResponse.json({ error: `カルテ生成に失敗しました：${msg}` }, { status: 500 });
  }
}
