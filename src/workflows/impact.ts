import { getWorkflowMetadata } from "workflow";
import type { ImpactItem, Project, SectionDraft } from "@/lib/types";
import { defaultPrompts } from "@/lib/samples";
import { renderTemplate } from "@/lib/promptVars";
import { safeJsonParse } from "@/lib/json";
import { runAiStep } from "./shared";

export type ImpactWorkflowInput = {
  project: Project;
  changedChapterId: string;
  changedSectionId: string;
};

export type ImpactWorkflowResult =
  | { ok: true; items: ImpactItem[]; meta: { runId: string } }
  | { ok: false; error: string; meta: { runId: string } };

/**
 * 上流の節を編集したとき、既に本文がある下流の節のうち整合性が崩れうるものを特定する。
 */
export async function impactWorkflow(input: ImpactWorkflowInput): Promise<ImpactWorkflowResult> {
  "use workflow";
  const runId = getWorkflowMetadata().workflowRunId;
  return await impactStep(input, runId);
}

async function impactStep(
  input: ImpactWorkflowInput,
  runId: string,
): Promise<ImpactWorkflowResult> {
  "use step";
  const { project, changedChapterId, changedSectionId } = input;

  const changed = project.generatedSections.find(
    (d) => d.chapterId === changedChapterId && d.sectionId === changedSectionId,
  );

  // 構成順（章→節）で他の生成済み節を並べる
  const order = outlineOrder(project);
  const others = project.generatedSections
    .filter((d) => !(d.chapterId === changedChapterId && d.sectionId === changedSectionId))
    .sort((a, b) => rank(order, a) - rank(order, b));

  if (others.length === 0) {
    return { ok: true, items: [], meta: { runId } };
  }

  const otherSectionsText = others
    .map(
      (d) =>
        `[chapterId=${d.chapterId} sectionId=${d.sectionId}] ${d.chapterTitle} / ${d.sectionTitle}\n${d.body.slice(0, 400)}`,
    )
    .join("\n\n")
    .slice(0, 16000);

  const tpl = defaultPrompts.find((t) => t.id === "prompt-impact-detect")!;
  const userPrompt = renderTemplate(tpl.userPromptTemplate, {
    chapterTitle: changed?.chapterTitle ?? "",
    sectionTitle: changed?.sectionTitle ?? "",
    changedBody: (changed?.body ?? "（本文未生成）").slice(0, 4000),
    otherSections: otherSectionsText,
  });
  const formatNote = `\n\n出力は次のJSON形式（余計な文字は禁止）：\n${tpl.outputFormat}`;

  const result = await runAiStep(
    {
      messages: [
        { role: "system", content: tpl.systemPrompt },
        { role: "user", content: userPrompt + formatNote },
      ],
      maxTokens: 2000,
      maxAttempts: 2,
    },
    (raw) => {
      const parsed = safeJsonParse<{ items?: unknown }>(raw);
      if (!parsed) return null;
      const arr = Array.isArray((parsed as any).items) ? (parsed as any).items : [];
      const items = arr
        .map((it: any): ImpactItem | null => {
          const chapterId = typeof it?.chapterId === "string" ? it.chapterId : "";
          const sectionId = typeof it?.sectionId === "string" ? it.sectionId : "";
          const draft = others.find(
            (d) => d.chapterId === chapterId && d.sectionId === sectionId,
          );
          if (!draft) return null; // 実在する生成済み節に限定
          return {
            chapterId,
            sectionId,
            chapterTitle: draft.chapterTitle,
            sectionTitle: draft.sectionTitle,
            reason: typeof it?.reason === "string" ? it.reason : "",
            severity: it?.severity === "low" ? "low" : "high",
          };
        })
        .filter((x: ImpactItem | null): x is ImpactItem => !!x);
      return { items };
    },
  );

  if (!result.parsed) {
    return { ok: false, error: "影響の検出に失敗しました。", meta: { runId } };
  }
  return { ok: true, items: result.parsed.items, meta: { runId } };
}

function outlineOrder(project: Project): Map<string, number> {
  const m = new Map<string, number>();
  let i = 0;
  for (const c of project.selectedOutline?.chapters ?? []) {
    for (const s of c.sections ?? []) {
      m.set(`${c.id}::${s.id}`, i++);
    }
  }
  return m;
}

function rank(order: Map<string, number>, d: SectionDraft): number {
  return order.get(`${d.chapterId}::${d.sectionId}`) ?? 9999;
}
