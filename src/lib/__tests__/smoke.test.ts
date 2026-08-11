import { describe, it, expect } from "vitest";
import { parseScreenplayBody } from "@/lib/screenplay";

describe("harness", () => {
  it("resolves the @/ alias and TS/extensionless imports", () => {
    // parseScreenplayBody は @/lib/screenplay の実関数。import が解決できれば alias+拡張子なし解決が効いている。
    expect(typeof parseScreenplayBody).toBe("function");
    const lines = parseScreenplayBody("　ト書きの行。");
    expect(Array.isArray(lines)).toBe(true);
    expect(lines.length).toBeGreaterThan(0);
  });
});
