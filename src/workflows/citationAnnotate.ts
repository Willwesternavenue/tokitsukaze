import { getWorkflowMetadata } from "workflow";
import type { Reference } from "@/lib/types";
import { authorYearMarker } from "@/lib/citation";
import { safeJsonParse } from "@/lib/json";
import { runAiStep } from "./shared";
import type { CitationProposal } from "@/lib/citationAnnotate";

export type AnnotateCitationsInput = {
  body: string;
  references: Reference[];
  field?: string;
  researchQuestion?: string;
};

export type AnnotateCitationsResult =
  | {
      ok: true;
      proposals: CitationProposal[];
      meta: { model: string; provider: string; attempts: number; runId: string };
    }
  | {
      ok: false;
      error: string;
      raw?: string;
      meta: { model: string; provider: string; attempts: number; runId: string };
    };

export async function annotateCitationsWorkflow(
  input: AnnotateCitationsInput,
): Promise<AnnotateCitationsResult> {
  "use workflow";
  const runId = getWorkflowMetadata().workflowRunId;
  return annotateCitationsStep(input, runId);
}

async function annotateCitationsStep(
  input: AnnotateCitationsInput,
  runId: string,
): Promise<AnnotateCitationsResult> {
  "use step";

  const refsBlock = input.references
    .map(
      (r) =>
        `- refId=${r.id} ${authorYearMarker(r)} ${r.title}${r.author ? ` / ${r.author}` : ""}${
          r.year ? ` (${r.year})` : ""
        }${r.notes ? ` — ${r.notes}` : ""}`,
    )
    .join("\n");

  const system =
    "あなたは学術論文の編集者です。登録済みの参考文献が明確に支持する主張にだけ引用を付けます。本文の文章は一切変えません（言い換え・要約・加筆・約物や全角半角の変更も禁止）。";

  const user = [
    `分野: ${input.field || "（未設定）"}`,
    `リサーチクエスチョン: ${input.researchQuestion || "（未設定）"}`,
    `# 登録文献`,
    refsBlock,
    `# 本文`,
    input.body.slice(0, 14000),
    `# 指示`,
    "本文中で、上の登録文献が明確に支持する主張にだけ引用を付けてください。無ければ付けない。",
    "各引用について、その主張を含む文の逐語断片を quote に、本文から一字一句そのままコピーしてください（全角半角・鉤括弧・ダッシュ等を勝手に正規化しない。本文中で一意に定まる長さにする）。マーカーの正確な挿入位置はシステムが句点基準で決めるので、quote は句点で切らなくてよい。",
    "refId は上の登録文献のIDのみ。reason は選定根拠を短く。",
    '出力は次のJSONのみ（他の文字は禁止）: {"proposals":[{"quote":"…","refId":"…","reason":"…"}]}',
  ].join("\n\n");

  const result = await runAiStep(
    {
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      maxTokens: 4000,
      maxAttempts: 2,
    },
    (raw) => {
      const parsed = safeJsonParse<{ proposals?: unknown }>(raw);
      if (!parsed || !Array.isArray(parsed.proposals)) return null;
      const out: CitationProposal[] = [];
      for (const p of parsed.proposals as unknown[]) {
        const o = (p ?? {}) as Record<string, unknown>;
        const quote = typeof o.quote === "string" ? o.quote : "";
        const refId = typeof o.refId === "string" ? o.refId : "";
        const reason = typeof o.reason === "string" ? o.reason : "";
        if (quote && refId) out.push({ quote, refId, reason });
      }
      return out; // 空配列も有効な結果（引用なしと解釈）
    },
  );

  if (!result.parsed) {
    return {
      ok: false,
      error: result.timedOut
        ? "引用候補の生成が制限時間内に完了しませんでした。本文を短くして再試行してください。"
        : "AI出力をJSONとして解釈できませんでした。もう一度お試しください。",
      raw: result.raw,
      meta: { model: result.model, provider: result.provider, attempts: result.attempts, runId },
    };
  }
  return {
    ok: true,
    proposals: result.parsed,
    meta: { model: result.model, provider: result.provider, attempts: result.attempts, runId },
  };
}
