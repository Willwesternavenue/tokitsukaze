import { NextResponse } from "next/server";
import { AIConfigError, generateJson } from "@/lib/ai";
import { defaultPrompts } from "@/lib/samples";
import { safeJsonParse } from "@/lib/json";
import { renderTemplate } from "@/lib/promptVars";
import { makeId } from "@/lib/ids";
import type { Chapter, Project, PromptTemplate, Section, SectionDraft } from "@/lib/types";

export const runtime = "nodejs";

type Body = {
  project: Project;
  chapter: Chapter;
  section: Section;
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

  const project = body?.project;
  const chapter = body?.chapter;
  const section = body?.section;
  if (!project || !chapter || !section) {
    return NextResponse.json({ error: "必要なデータが不足しています。" }, { status: 400 });
  }
  if (!project.interviewNotes?.trim()) {
    return NextResponse.json({ error: "取材メモが空です。" }, { status: 400 });
  }

  const tpl = body.promptTemplate || defaultPrompts.find((d) => d.id === "prompt-draft")!;

  const previous = project.generatedSections
    .map((d) => `■ ${d.chapterTitle} / ${d.sectionTitle}\n${d.body.slice(0, 240)}`)
    .join("\n\n");

  const userPrompt = renderTemplate(tpl.userPromptTemplate, {
    projectName: project.name,
    intervieweeName: project.intervieweeName,
    theme: project.theme,
    targetReader: project.targetReader,
    desiredTone: project.desiredTone,
    interviewNotes: project.interviewNotes,
    writingMemory: JSON.stringify(project.writingMemory ?? {}, null, 2),
    outlineSummary: project.selectedOutline
      ? `${project.selectedOutline.title}：${project.selectedOutline.concept}`
      : "",
    previousChapterSummaries: previous || "（まだ生成済みの章なし）",
    chapterTitle: chapter.title,
    chapterNumber: String(chapter.chapterNumber),
    chapterSummary: chapter.summary ?? "",
    sectionTitle: section.title,
    sectionSummary: section.summary ?? "",
  });

  const formatNote = `\n\n出力は次のJSON形式（余計な文字は禁止）：\n${tpl.outputFormat}`;

  try {
    const raw = await generateJson(
      [
        { role: "system", content: tpl.systemPrompt },
        { role: "user", content: userPrompt + formatNote },
      ],
      { maxTokens: 3200 },
    );

    const parsed = safeJsonParse<{ draft?: any } | any>(raw);
    if (!parsed) {
      console.error("[generate-draft] JSON parse failed. raw output:\n", raw);
      // JSON parseに失敗してもフォールバックの本文を返してUIを壊さない
      const fallback: SectionDraft = {
        id: makeId("draft"),
        chapterId: chapter.id,
        sectionId: section.id,
        chapterTitle: chapter.title,
        sectionTitle: section.title,
        body: typeof raw === "string" ? raw.slice(0, 2000) : "",
        editorNotes: ["AI出力をJSONとして解釈できなかったため、テキストをそのまま表示しています。"],
        followUpQuestions: [],
        factCheckPoints: [],
        continuityNotes: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      return NextResponse.json({ draft: fallback, parseFailed: true });
    }

    const draftRaw = (parsed as any).draft ?? parsed;
    const draft: SectionDraft = {
      id: typeof draftRaw?.id === "string" && draftRaw.id ? draftRaw.id : makeId("draft"),
      chapterId: chapter.id,
      sectionId: section.id,
      chapterTitle: chapter.title,
      sectionTitle: section.title,
      body: typeof draftRaw?.body === "string" ? draftRaw.body : "",
      editorNotes: strArr(draftRaw?.editorNotes),
      followUpQuestions: strArr(draftRaw?.followUpQuestions),
      factCheckPoints: strArr(draftRaw?.factCheckPoints),
      continuityNotes: strArr(draftRaw?.continuityNotes),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    return NextResponse.json({ draft });
  } catch (e) {
    if (e instanceof AIConfigError) {
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `AI呼び出しに失敗しました：${msg}` }, { status: 500 });
  }
}
