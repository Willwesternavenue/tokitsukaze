import { NextResponse } from "next/server";
import { AIConfigError, generateJsonWithRetry } from "@/lib/ai";
import { defaultPrompts } from "@/lib/samples";
import { safeJsonParse } from "@/lib/json";
import { renderTemplate } from "@/lib/promptVars";
import type { PromptTemplate, SectionDraft, WritingMemory } from "@/lib/types";

export const runtime = "nodejs";

type Body = {
  draft: SectionDraft;
  writingMemory: WritingMemory;
  promptTemplate?: PromptTemplate;
};

function strArr(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "リクエスト本文が不正です。" }, { status: 400 });
  }

  if (!body?.draft?.body?.trim()) {
    return NextResponse.json({ error: "レビュー対象の本文がありません。" }, { status: 400 });
  }

  const tpl = body.promptTemplate || defaultPrompts.find((d) => d.id === "prompt-review")!;
  const userPrompt = renderTemplate(tpl.userPromptTemplate, {
    body: body.draft.body,
    writingMemory: JSON.stringify(body.writingMemory ?? {}, null, 2),
  });
  const formatNote = `\n\n出力は次のJSON形式（余計な文字は禁止）：\n${tpl.outputFormat}`;

  try {
    const result = await generateJsonWithRetry(
      [
        { role: "system", content: tpl.systemPrompt },
        { role: "user", content: userPrompt + formatNote },
      ],
      (raw) => {
        const parsed = safeJsonParse<any>(raw);
        if (!parsed) return null;
        return {
          editorNotes: strArr(parsed.editorNotes),
          followUpQuestions: strArr(parsed.followUpQuestions),
          factCheckPoints: strArr(parsed.factCheckPoints),
          revisionSuggestions: strArr(parsed.revisionSuggestions),
        };
      },
      { maxAttempts: 2 },
    );
    if (!result.parsed) {
      console.error(
        `[review-draft] all ${result.attempts} attempts failed. last raw:\n`,
        result.raw,
      );
      return NextResponse.json({
        editorNotes: [],
        followUpQuestions: [],
        factCheckPoints: [],
        revisionSuggestions: [
          `AI出力をJSONとして解釈できませんでした (${result.attempts}回試行)。`,
        ],
        parseFailed: true,
      });
    }
    return NextResponse.json(result.parsed);
  } catch (e) {
    if (e instanceof AIConfigError) {
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `AI呼び出しに失敗しました：${msg}` }, { status: 500 });
  }
}
