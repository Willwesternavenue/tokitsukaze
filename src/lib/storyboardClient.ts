import { getSelectedReferenceWorks } from "@/lib/storage";
import type { Project, Storyboard } from "@/lib/types";

/**
 * 脚本モードの1シーンから絵コンテ画像を生成する。
 * APIルート（/api/generate-storyboard）は referenceWorks をトップレベルで要求する
 * （Project 自体は referenceWorkIds しか持たず、カルテ本体はグローバル保管のため）。
 * /api/generate-draft と同じ規約で getSelectedReferenceWorks(project) を解決して渡す。
 */
export async function requestStoryboard(
  project: Project,
  chapterId: string,
  sectionId: string,
): Promise<Storyboard> {
  const res = await fetch("/api/generate-storyboard", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project,
      chapterId,
      sectionId,
      referenceWorks: getSelectedReferenceWorks(project),
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? "絵コンテ生成に失敗しました。");
  return data as Storyboard;
}
