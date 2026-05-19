import { NextResponse } from "next/server";
import { AIConfigError, generateJsonWithRetry } from "@/lib/ai";
import { defaultPrompts } from "@/lib/samples";
import { safeJsonParse } from "@/lib/json";
import { renderTemplate } from "@/lib/promptVars";
import { makeId } from "@/lib/ids";
import type { Chapter, OutlineProposal, OutlineType, PromptTemplate, Section } from "@/lib/types";

export const runtime = "nodejs";

type Body = {
  projectName: string;
  intervieweeName: string;
  theme: string;
  targetReader: string;
  desiredTone: string;
  interviewNotes: string;
  promptTemplate?: PromptTemplate;
};

const VALID_TYPES: OutlineType[] = ["chronological", "thematic", "narrative"];

function normalizeType(raw: unknown, idx: number): OutlineType {
  const s = typeof raw === "string" ? raw.toLowerCase() : "";
  if ((VALID_TYPES as string[]).includes(s)) return s as OutlineType;
  if (s.includes("時系列") || s.includes("chrono")) return "chronological";
  if (s.includes("テーマ") || s.includes("thema")) return "thematic";
  if (s.includes("人物") || s.includes("narrat") || s.includes("読み物")) return "narrative";
  return VALID_TYPES[Math.min(idx, VALID_TYPES.length - 1)];
}

function normalizeSections(raw: unknown): Section[] {
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

function normalizeChapters(raw: unknown): Chapter[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((c: any, i: number): Chapter | null => {
      const title = typeof c?.title === "string" ? c.title : "";
      if (!title) return null;
      return {
        id: typeof c?.id === "string" && c.id ? c.id : `chapter-${i + 1}-${makeId("c")}`,
        chapterNumber: typeof c?.chapterNumber === "number" ? c.chapterNumber : i + 1,
        title,
        summary: typeof c?.summary === "string" ? c.summary : "",
        sections: normalizeSections(c?.sections),
      };
    })
    .filter((x): x is Chapter => !!x);
}

function normalizeProposals(raw: unknown): OutlineProposal[] {
  const arr = Array.isArray(raw) ? raw : [];
  return arr
    .map((p: any, i: number): OutlineProposal | null => {
      const title = typeof p?.title === "string" ? p.title : "";
      const chapters = normalizeChapters(p?.chapters);
      if (!title || chapters.length === 0) return null;
      return {
        id: typeof p?.id === "string" && p.id ? p.id : `outline-${i + 1}-${makeId("o")}`,
        title,
        type: normalizeType(p?.type, i),
        concept: typeof p?.concept === "string" ? p.concept : "",
        recommendedFor: typeof p?.recommendedFor === "string" ? p.recommendedFor : "",
        chapters,
      };
    })
    .filter((x): x is OutlineProposal => !!x);
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "リクエスト本文が不正です。" }, { status: 400 });
  }

  if (!body?.interviewNotes?.trim()) {
    return NextResponse.json({ error: "取材メモが空です。" }, { status: 400 });
  }

  const tpl = body.promptTemplate || defaultPrompts.find((d) => d.id === "prompt-outline")!;
  const systemPrompt = tpl.systemPrompt;
  const userPrompt = renderTemplate(tpl.userPromptTemplate, {
    projectName: body.projectName ?? "",
    intervieweeName: body.intervieweeName ?? "",
    theme: body.theme ?? "",
    targetReader: body.targetReader ?? "",
    desiredTone: body.desiredTone ?? "",
    interviewNotes: body.interviewNotes,
  });

  const formatNote = `\n\n出力は次のJSON形式で返してください（余計な文字は禁止）。\n${tpl.outputFormat}`;

  try {
    const result = await generateJsonWithRetry(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt + formatNote },
      ],
      (raw) => {
        const parsed = safeJsonParse<{ proposals?: unknown }>(raw);
        if (!parsed) return null;
        const proposals = normalizeProposals((parsed as any).proposals ?? parsed);
        return proposals.length > 0 ? { proposals } : null;
      },
      { maxTokens: 16000, maxAttempts: 2 },
    );
    if (!result.parsed) {
      console.error(
        `[generate-outline] all ${result.attempts} attempts failed. last raw:\n`,
        result.raw,
      );
      return NextResponse.json(
        {
          error: `AI出力をJSONとして解釈できませんでした (${result.attempts}回試行)。プロンプトまたは入力内容を確認してください。`,
          raw: result.raw,
        },
        { status: 502 },
      );
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
