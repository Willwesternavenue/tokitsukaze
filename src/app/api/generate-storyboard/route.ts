import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { buildStoryboardPrompt } from "@/lib/storyboardPrompt";
import { generateStoryboardImage, ImageGenConfigError } from "@/lib/imageGen";
import type { Project, ReferenceCharacterCard, ReferenceWork } from "@/lib/types";

export const runtime = "nodejs";

// 参照ライブラリのカルテ本体はグローバル保管（Project は referenceWorkIds しか持たない）。
// クライアント側で getSelectedReferenceWorks(project) を解決し、/api/generate-draft と
// 同じ規約でリクエストボディに referenceWorks として渡す。
type Body = {
  project?: Project;
  chapterId?: string;
  sectionId?: string;
  referenceWorks?: ReferenceWork[];
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "リクエスト本文が不正です。" }, { status: 400 });
  }
  const { project, chapterId, sectionId, referenceWorks } = body ?? {};
  if (!project || !chapterId || !sectionId) {
    return NextResponse.json({ error: "必要なデータが不足しています。" }, { status: 400 });
  }
  if (project.genre !== "screenplay") {
    return NextResponse.json({ error: "絵コンテ生成は脚本モード専用です。" }, { status: 400 });
  }

  const draft = project.generatedSections?.find(
    (d) => d.chapterId === chapterId && d.sectionId === sectionId,
  );
  const section = project.selectedOutline?.chapters
    .flatMap((c) => c.sections)
    .find((s) => s.id === sectionId);
  if (!draft) {
    return NextResponse.json({ error: "対象シーンの本文が見つかりません。先に本文を生成してください。" }, { status: 400 });
  }

  const present = section?.sceneMeta?.presentCharacters ?? [];
  const characters: ReferenceCharacterCard[] = (referenceWorks ?? [])
    .flatMap((w) => w.characters ?? [])
    .filter((c) => present.includes(c.name));

  const prompt = buildStoryboardPrompt({
    sceneTitle: section?.title,
    sceneMeta: section?.sceneMeta,
    body: draft.body ?? "",
    characters,
  });

  try {
    const { bytes, mime, model } = await generateStoryboardImage(prompt);
    const ext = mime === "image/webp" ? "webp" : mime === "image/jpeg" ? "jpg" : "png";
    const path = `storyboards/${project.id}/${sectionId}-${Date.now()}.${ext}`;
    const { url } = await put(path, bytes, { access: "public", contentType: mime });
    const storyboard = { url, prompt, model, generatedAt: new Date().toISOString() };
    return NextResponse.json(storyboard, { status: 200 });
  } catch (e) {
    if (e instanceof ImageGenConfigError) {
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[generate-storyboard] error", msg);
    return NextResponse.json({ error: `絵コンテ生成に失敗しました：${msg}` }, { status: 500 });
  }
}
