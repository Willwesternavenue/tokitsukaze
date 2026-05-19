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
      // {title: "..."} 形式
      if (s && typeof s === "object") {
        const title = typeof s.title === "string" ? s.title : typeof s.name === "string" ? s.name : "";
        if (!title) return null;
        return {
          id: typeof s.id === "string" && s.id ? s.id : `section-${i + 1}-${makeId("s")}`,
          title,
          summary:
            typeof s.summary === "string"
              ? s.summary
              : typeof s.description === "string"
                ? s.description
                : undefined,
        };
      }
      // 文字列だけの形式 "小見出し"
      if (typeof s === "string" && s.trim()) {
        return { id: `section-${i + 1}-${makeId("s")}`, title: s.trim() };
      }
      return null;
    })
    .filter((x): x is Section => !!x);
}

/**
 * AI の出力形状は揺れる。以下の形を全部吸収する:
 *   { outline: { chapters: [{ id, title, sections: [...] }] } }
 *   { chapters: [...] }
 *   [ { id, title, sections } ]                              // ルートが章配列
 *   { "chapter-1": ["小見出し", ...] }                       // 章ID→配列のマップ
 *   { sections: { "chapter-1": [...] } }
 *   { "第1章 東京での日々": ["小見出し", ...] }              // 章タイトル→配列のマップ
 */
function extractAiChapters(aiOutline: any): any[] {
  if (Array.isArray(aiOutline)) return aiOutline;
  if (Array.isArray(aiOutline?.chapters)) return aiOutline.chapters;
  if (Array.isArray(aiOutline?.outline?.chapters)) return aiOutline.outline.chapters;
  return [];
}

function findSectionsByKey(aiOutline: any, chapter: Chapter): unknown {
  if (!aiOutline || typeof aiOutline !== "object") return null;
  // sections プロパティがオブジェクト形式 {chapter-id: [...]}
  const sectionsMap =
    aiOutline.sections && typeof aiOutline.sections === "object" && !Array.isArray(aiOutline.sections)
      ? aiOutline.sections
      : aiOutline;
  if (!sectionsMap || typeof sectionsMap !== "object") return null;
  // chapter.id, chapter.title, "第N章 ...", chapter.chapterNumber でlookup
  const keys = [
    chapter.id,
    chapter.title,
    `第${chapter.chapterNumber}章　${chapter.title}`,
    `第${chapter.chapterNumber}章 ${chapter.title}`,
    `chapter-${chapter.chapterNumber}`,
    String(chapter.chapterNumber),
  ];
  for (const k of keys) {
    if (k && (sectionsMap as any)[k] !== undefined) return (sectionsMap as any)[k];
  }
  return null;
}

function mergeOutline(original: OutlineProposal, aiOutline: any): OutlineProposal {
  const aiChapters = extractAiChapters(aiOutline);
  const next: Chapter[] = original.chapters.map((c, i) => {
    // パターン1: index一致 or id/title一致の章を探す
    const matched =
      aiChapters[i] ||
      aiChapters.find((x: any) => x?.id === c.id) ||
      aiChapters.find((x: any) => typeof x?.title === "string" && x.title.includes(c.title.slice(0, 10)));
    let aiSections = asSectionList(matched?.sections);
    // パターン2: ルート直下にマップ形式で配置されている
    if (aiSections.length === 0) {
      aiSections = asSectionList(findSectionsByKey(aiOutline, c));
    }
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
        const merged = mergeOutline(body.selectedOutline, aiOutline);
        // sections が1つも抽出できなければ「失敗」とみなしてリトライさせる
        const totalSections = merged.chapters.reduce((sum, c) => sum + (c.sections?.length ?? 0), 0);
        if (totalSections === 0) {
          console.warn(
            "[generate-sections] no sections extracted from AI output. raw:\n",
            raw,
          );
          return null;
        }
        return merged;
      },
      { maxTokens: 12000, maxAttempts: 2 },
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
