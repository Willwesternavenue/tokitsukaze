/**
 * アップロードファイルからプレーンテキストを抽出する（サーバ専用）。
 * ingest-reference（参照ライブラリ）と extract-source（翻訳書の原文取り込み）で共用。
 */
export async function extractTextFromFile(file: File): Promise<string> {
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
