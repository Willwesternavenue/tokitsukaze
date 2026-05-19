import { NextResponse } from "next/server";
import { AIConfigError, generateJsonWithRetry } from "@/lib/ai";
import { defaultPrompts } from "@/lib/samples";
import { safeJsonParse } from "@/lib/json";
import { renderTemplate } from "@/lib/promptVars";
import { makeId } from "@/lib/ids";
import type { Chapter, OutlineProposal, Section, WritingMemory } from "@/lib/types";

export const runtime = "nodejs";

type Body = {
  selectedOutline: OutlineProposal;
  interviewNotes: string;
  writingMemory: WritingMemory;
};

function asSectionList(raw: unknown): Section[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((s: any, i: number): Section | null => {
      const title = typeof s?.title === "string" ? s.title : "";
      if (!title) return null;
      return {
        id: typeof s?.id === "string" && s.id ? s.id : `section-${i + 1}-${makeId("s")}`,
        title,
        summary: typeof s?.summary === "string" ? s.summary : undefined,
      };
    })
    .filter((x): x is Section => !!x);
}

function mergeOutline(original: OutlineProposal, aiOutline: any): OutlineProposal {
  const aiChapters: any[] = Array.isArray(aiOutline?.chapters) ? aiOutline.chapters : [];
  const next: Chapter[] = original.chapters.map((c, i) => {
    const ai = aiChapters[i] || aiChapters.find((x) => x?.id === c.id || x?.title === c.title);
    const aiSections = asSectionList(ai?.sections);
    return {
      ...c,
      sections: aiSections.length ? aiSections : c.sections ?? [],
    };
  });
  return { ...original, chapters: next };
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "リクエスト本文が不正です。" }, { status: 400 });
  }

  if (!body?.selectedOutline?.chapters?.length) {
    return NextResponse.json({ error: "選択された構成案がありません。" }, { status: 400 });
  }

  const tpl = defaultPrompts.find((d) => d.id === "prompt-sections")!;
  const systemPrompt = tpl.systemPrompt;
  const userPrompt = renderTemplate(tpl.userPromptTemplate, {
    interviewNotes: body.interviewNotes ?? "",
    selectedOutline: JSON.stringify(body.selectedOutline, null, 2),
    writingMemory: JSON.stringify(body.writingMemory ?? {}, null, 2),
  });

  const formatNote = `\n\n出力は次のJSON形式（余計な文字は禁止）：\n${tpl.outputFormat}`;

  try {
    const result = await generateJsonWithRetry(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt + formatNote },
      ],
      (raw) => {
        const parsed = safeJsonParse<{ outline?: any }>(raw);
        if (!parsed) return null;
        const aiOutline = (parsed as any)?.outline ?? parsed;
        return mergeOutline(body.selectedOutline, aiOutline);
      },
      { maxAttempts: 2 },
    );
    if (!result.parsed) {
      console.error(
        `[generate-sections] all ${result.attempts} attempts failed. last raw:\n`,
        result.raw,
      );
      // フォールバック: 既存構成案をそのまま返す (画面側で「小見出しが空」の表示にする)
      return NextResponse.json({
        outline: body.selectedOutline,
        parseFailed: true,
        raw: result.raw,
      });
    }
    return NextResponse.json({ outline: result.parsed });
  } catch (e) {
    if (e instanceof AIConfigError) {
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `AI呼び出しに失敗しました：${msg}` }, { status: 500 });
  }
}
