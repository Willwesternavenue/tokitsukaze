import { describe, it, expect } from "vitest";
import { extractInlineImage } from "@/lib/imageGen";

const b64 = Buffer.from("hello").toString("base64");

describe("extractInlineImage", () => {
  it("camelCase inlineData を取り出す", () => {
    const json = { candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: b64 } }] } }] };
    const { bytes, mime } = extractInlineImage(json);
    expect(mime).toBe("image/png");
    expect(bytes.toString()).toBe("hello");
  });

  it("snake_case inline_data も取り出す", () => {
    const json = { candidates: [{ content: { parts: [{ inline_data: { mime_type: "image/webp", data: b64 } }] } }] };
    const { mime } = extractInlineImage(json);
    expect(mime).toBe("image/webp");
  });

  it("画像が無ければ throw", () => {
    expect(() => extractInlineImage({ candidates: [{ content: { parts: [{ text: "no image" }] } }] })).toThrow();
  });
});
