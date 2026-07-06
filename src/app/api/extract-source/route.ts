import { NextResponse } from "next/server";
import { extractTextFromFile } from "@/lib/extractFile";

export const runtime = "nodejs";

/**
 * 翻訳書モード: 原文ファイル（docx / pdf / txt / md）からテキストを抽出して返す。
 * ファイル自体は保存しない（既存方針: 原本は抽出処理の間だけ扱う）。
 * 章分割はクライアント側で行う。
 */
export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "ファイルの受信に失敗しました。" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "ファイルが添付されていません。" }, { status: 400 });
  }

  try {
    const text = await extractTextFromFile(file);
    if (!text.trim()) {
      return NextResponse.json(
        { error: "本文テキストが取得できませんでした（画像PDF等の可能性）。" },
        { status: 400 },
      );
    }
    return NextResponse.json({ text, filename: file.name, charCount: text.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `テキスト抽出に失敗しました：${msg}` }, { status: 400 });
  }
}
