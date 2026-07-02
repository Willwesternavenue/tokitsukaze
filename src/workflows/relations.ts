import { getWorkflowMetadata } from "workflow";
import type { CharacterRelationship, NovelCharacter, Project } from "@/lib/types";
import { defaultPrompts } from "@/lib/samples";
import { renderTemplate } from "@/lib/promptVars";
import { safeJsonParse } from "@/lib/json";
import { makeId } from "@/lib/ids";
import { runAiStep } from "./shared";

export type RelationsWorkflowInput = {
  project: Project;
};

export type RelationsWorkflowResult = {
  ok: boolean;
  relationships: CharacterRelationship[]; // AI 抽出分のみ (source: "ai")
  error?: string;
  meta: { model: string; provider: string; attempts: number; runId: string };
};

/**
 * 人物相関図の関係抽出。登場人物 + プロット素材 + 生成済み本文から
 * 関係 (from/to/label/mutual) を抽出する。source: "ai" を付けて返し、
 * クライアント側で手動分 (source: "manual") とマージする。
 */
export async function relationsWorkflow(
  input: RelationsWorkflowInput,
): Promise<RelationsWorkflowResult> {
  "use workflow";
  const runId = getWorkflowMetadata().workflowRunId;
  return await relationsStep(input, runId);
}

async function relationsStep(
  input: RelationsWorkflowInput,
  runId: string,
): Promise<RelationsWorkflowResult> {
  "use step";

  const { project } = input;
  const characters = project.characters ?? [];
  const tpl = defaultPrompts.find((d) => d.id === "prompt-relations")!;

  const charactersText = characters
    .map(
      (c) =>
        `- id: ${c.id} / 名前: ${c.name} / 役割: ${c.role}` +
        (c.profile ? ` / ${c.profile.slice(0, 80)}` : ""),
    )
    .join("\n");

  const sectionExcerpts =
    project.generatedSections
      .map((d) => `■ ${d.chapterTitle} / ${d.sectionTitle}\n${d.body.slice(0, 400)}`)
      .join("\n\n")
      .slice(0, 12000) || "（まだ本文なし）";

  const manual = (project.storyBible?.relationships ?? []).filter((r) => r.source === "manual");
  const manualText =
    manual
      .map((r) => {
        const from = characters.find((c) => c.id === r.fromId)?.name ?? r.fromId;
        const to = characters.find((c) => c.id === r.toId)?.name ?? r.toId;
        return `- ${from} → ${to}: ${r.label}${r.mutual ? "（相互）" : ""}`;
      })
      .join("\n") || "（なし）";

  const userPrompt = renderTemplate(tpl.userPromptTemplate, {
    characters: charactersText,
    interviewNotes: project.interviewNotes.slice(0, 16000),
    sectionExcerpts,
    manualRelationships: manualText,
  });
  const formatNote = `\n\n出力は次のJSON形式（余計な文字は禁止）：\n${tpl.outputFormat}`;

  const result = await runAiStep(
    {
      messages: [
        { role: "system", content: tpl.systemPrompt },
        { role: "user", content: userPrompt + formatNote },
      ],
      maxTokens: 4096,
      maxAttempts: 2,
    },
    (raw) => {
      const parsed = safeJsonParse<{ relationships?: unknown }>(raw);
      if (!parsed) return null;
      const rels = normalizeRelationships((parsed as any).relationships, characters);
      // 0 件は「関係が読み取れなかった」正当な結果としてありうるので成功扱い
      return { relationships: rels };
    },
  );

  if (!result.parsed) {
    return {
      ok: false,
      relationships: [],
      error: `AI出力をJSONとして解釈できませんでした (${result.attempts}回試行)。`,
      meta: { model: result.model, provider: result.provider, attempts: result.attempts, runId },
    };
  }

  return {
    ok: true,
    relationships: result.parsed.relationships,
    meta: { model: result.model, provider: result.provider, attempts: result.attempts, runId },
  };
}

/**
 * AI 出力を CharacterRelationship[] に正規化する。
 * - fromId/toId は id 完全一致 → 名前一致 の順で解決。解決できなければ捨てる
 * - 自分自身への関係、既出の重複 (同一 from/to/label) は捨てる
 */
function normalizeRelationships(
  raw: unknown,
  characters: NovelCharacter[],
): CharacterRelationship[] {
  if (!Array.isArray(raw)) return [];
  const byId = new Map(characters.map((c) => [c.id, c]));
  const byName = new Map(characters.map((c) => [c.name.trim(), c]));

  function resolve(v: unknown): string | null {
    if (typeof v !== "string" || !v.trim()) return null;
    const s = v.trim();
    if (byId.has(s)) return s;
    const byNameHit = byName.get(s);
    if (byNameHit) return byNameHit.id;
    // 名前の部分一致 (「佐藤一郎（仮名）」vs「佐藤一郎」等の揺れを吸収)
    const partial = characters.find((c) => c.name.includes(s) || s.includes(c.name));
    return partial?.id ?? null;
  }

  const seen = new Set<string>();
  const out: CharacterRelationship[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const fromId = resolve((r as any).fromId);
    const toId = resolve((r as any).toId);
    const label = typeof (r as any).label === "string" ? (r as any).label.trim() : "";
    if (!fromId || !toId || !label || fromId === toId) continue;
    const key = `${fromId}|${toId}|${label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: makeId("rel"),
      fromId,
      toId,
      label: label.slice(0, 20),
      mutual: (r as any).mutual === true,
      notes: typeof (r as any).notes === "string" ? (r as any).notes : undefined,
      source: "ai",
    });
  }
  return out;
}
