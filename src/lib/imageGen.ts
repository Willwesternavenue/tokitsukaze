export class ImageGenConfigError extends Error {}

const DEFAULT_MODEL = "gemini-3.1-flash-image";

type InlineData = { data?: string; mimeType?: string; mime_type?: string };

export function extractInlineImage(json: unknown): { bytes: Buffer; mime: string } {
  const parts =
    (json as any)?.candidates?.[0]?.content?.parts ?? [];
  for (const p of parts) {
    const inline: InlineData | undefined = p?.inlineData ?? p?.inline_data;
    if (inline?.data) {
      return {
        bytes: Buffer.from(inline.data, "base64"),
        mime: inline.mimeType ?? inline.mime_type ?? "image/png",
      };
    }
  }
  throw new Error("画像データが応答に含まれていませんでした");
}

export async function generateStoryboardImage(
  prompt: string,
): Promise<{ bytes: Buffer; mime: string; model: string }> {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) throw new ImageGenConfigError("GOOGLE_API_KEY が未設定です。画像生成には Google のAPIキーが必要です。");
  const model = process.env.GEMINI_IMAGE_MODEL || DEFAULT_MODEL;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        // 一部モデルは ["TEXT","IMAGE"] を要求する。IMAGE 単独で失敗する場合は切替える（下の注記参照）。
        generationConfig: { responseModalities: ["IMAGE"] },
      }),
    },
  );
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`画像生成APIエラー (${res.status}): ${t.slice(0, 300)}`);
  }
  const json = await res.json();
  const { bytes, mime } = extractInlineImage(json);
  return { bytes, mime, model };
}
