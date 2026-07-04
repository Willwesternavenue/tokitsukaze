import { getWorkflowMetadata } from "workflow";
import type { ReferenceCharacterCard, ReferenceWork } from "@/lib/types";
import { defaultPrompts } from "@/lib/samples";
import { renderTemplate } from "@/lib/promptVars";
import { safeJsonParse } from "@/lib/json";
import { makeId } from "@/lib/ids";
import { runAiStep } from "./shared";

export type ReferenceIngestInput = {
  title: string;
  kind: "own" | "reference";
  isFiction: boolean;   // 小説・脚本なら true（characters を抽出）
  sourceFilename?: string;
  text: string;         // 抽出済みプレーンテキスト
};

export type ReferenceIngestResult =
  | { ok: true; work: ReferenceWork; meta: { runId: string } }
  | { ok: false; error: string; meta: { runId: string } };

const CHUNK_SIZE = 15000;
const MAX_CHUNKS = 12; // 長編の暴走防止（先頭〜均等サンプリング）

function chunkText(text: string): string[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (clean.length <= CHUNK_SIZE) return [clean];
  const chunks: string[] = [];
  for (let i = 0; i < clean.length; i += CHUNK_SIZE) {
    chunks.push(clean.slice(i, i + CHUNK_SIZE));
  }
  if (chunks.length <= MAX_CHUNKS) return chunks;
  // 均等サンプリング（冒頭・中盤・終盤を偏りなく拾う）
  const step = chunks.length / MAX_CHUNKS;
  const sampled: string[] = [];
  for (let i = 0; i < MAX_CHUNKS; i++) sampled.push(chunks[Math.floor(i * step)]);
  return sampled;
}

type ChunkAnalysis = {
  styleSamples: string[];
  claims: string[];
  facts: string[];
  characters: ReferenceCharacterCard[];
};

export async function analyzeReferenceWorkflow(
  input: ReferenceIngestInput,
): Promise<ReferenceIngestResult> {
  "use workflow";
  const runId = getWorkflowMetadata().workflowRunId;

  const chunks = chunkText(input.text);

  // 1. 各チャンクを並列分析
  const analyses = await Promise.all(
    chunks.map((chunk, i) => analyzeChunkStep(input.title, chunk, `${i + 1}/${chunks.length}`)),
  );
  const valid = analyses.filter((a): a is ChunkAnalysis => a !== null);

  // 2. 統合
  const card = await reduceStep(input, valid, runId);
  if (!card) {
    return { ok: false, error: "カルテの生成に失敗しました。", meta: { runId } };
  }
  return { ok: true, work: card, meta: { runId } };
}

async function analyzeChunkStep(
  title: string,
  chunk: string,
  part: string,
): Promise<ChunkAnalysis | null> {
  "use step";
  const tpl = defaultPrompts.find((d) => d.id === "prompt-reference-analyze")!;
  const userPrompt = renderTemplate(tpl.userPromptTemplate, { title, chunk, part });
  const formatNote = `\n\n出力は次のJSON形式（余計な文字は禁止）：\n${tpl.outputFormat}`;
  try {
    const result = await runAiStep(
      {
        messages: [
          { role: "system", content: tpl.systemPrompt },
          { role: "user", content: userPrompt + formatNote },
        ],
        maxTokens: 2000,
        maxAttempts: 1,
      },
      (raw) => {
        const parsed = safeJsonParse<any>(raw);
        if (!parsed) return null;
        return {
          styleSamples: strArr(parsed.styleSamples),
          claims: strArr(parsed.claims),
          facts: strArr(parsed.facts),
          characters: normalizeCharacters(parsed.characters),
        } as ChunkAnalysis;
      },
    );
    return result.parsed;
  } catch (e) {
    console.warn("[reference] chunk analyze failed", e);
    return null;
  }
}

async function reduceStep(
  input: ReferenceIngestInput,
  analyses: ChunkAnalysis[],
  runId: string,
): Promise<ReferenceWork | null> {
  "use step";
  const tpl = defaultPrompts.find((d) => d.id === "prompt-reference-reduce")!;
  const userPrompt = renderTemplate(tpl.userPromptTemplate, {
    title: input.title,
    isFiction: input.isFiction ? "はい" : "いいえ",
    analyses: JSON.stringify(analyses, null, 2).slice(0, 24000),
  });
  const formatNote = `\n\n出力は次のJSON形式（余計な文字は禁止）：\n${tpl.outputFormat}`;

  const result = await runAiStep(
    {
      messages: [
        { role: "system", content: tpl.systemPrompt },
        { role: "user", content: userPrompt + formatNote },
      ],
      maxTokens: 3000,
      maxAttempts: 2,
    },
    (raw) => {
      const parsed = safeJsonParse<any>(raw);
      if (!parsed) return null;
      const summary = typeof parsed.summary === "string" ? parsed.summary : "";
      const styleProfile = typeof parsed.styleProfile === "string" ? parsed.styleProfile : "";
      if (!summary && !styleProfile) return null;
      return { summary, styleProfile, parsed };
    },
  );

  if (!result.parsed) {
    // フォールバック: チャンク分析を素朴に結合
    return buildFallbackCard(input, analyses);
  }

  const p = result.parsed.parsed;
  return {
    id: makeId("work"),
    title: input.title,
    kind: input.kind,
    sourceFilename: input.sourceFilename,
    addedAt: new Date().toISOString(),
    charCount: input.text.length,
    summary: result.parsed.summary,
    styleProfile: result.parsed.styleProfile,
    keyClaims: strArr(p.keyClaims).slice(0, 12),
    canonFacts: strArr(p.canonFacts).slice(0, 20),
    characters: input.isFiction ? normalizeCharacters(p.characters) : undefined,
  };
}

function buildFallbackCard(input: ReferenceIngestInput, analyses: ChunkAnalysis[]): ReferenceWork {
  const dedup = (arr: string[]) => Array.from(new Set(arr.filter(Boolean)));
  return {
    id: makeId("work"),
    title: input.title,
    kind: input.kind,
    sourceFilename: input.sourceFilename,
    addedAt: new Date().toISOString(),
    charCount: input.text.length,
    summary: "（自動統合に失敗したため、抜粋分析から素朴に生成）",
    styleProfile: dedup(analyses.flatMap((a) => a.styleSamples)).slice(0, 8).join(" / "),
    keyClaims: dedup(analyses.flatMap((a) => a.claims)).slice(0, 12),
    canonFacts: dedup(analyses.flatMap((a) => a.facts)).slice(0, 20),
    characters: input.isFiction
      ? mergeCharacters(analyses.flatMap((a) => a.characters))
      : undefined,
  };
}

function mergeCharacters(chars: ReferenceCharacterCard[]): ReferenceCharacterCard[] {
  const byName = new Map<string, ReferenceCharacterCard>();
  for (const c of chars) {
    const key = c.name.trim();
    if (!key) continue;
    const ex = byName.get(key);
    if (ex) {
      ex.voice = ex.voice || c.voice;
      ex.keyLines = Array.from(new Set([...ex.keyLines, ...c.keyLines])).slice(0, 8);
      ex.facts = Array.from(new Set([...ex.facts, ...c.facts])).slice(0, 8);
    } else {
      byName.set(key, {
        name: key,
        voice: c.voice,
        keyLines: c.keyLines.slice(0, 8),
        facts: c.facts.slice(0, 8),
      });
    }
  }
  return Array.from(byName.values()).slice(0, 20);
}

function normalizeCharacters(raw: unknown): ReferenceCharacterCard[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((c: any): ReferenceCharacterCard | null => {
      const name = typeof c?.name === "string" ? c.name.trim() : "";
      if (!name) return null;
      return {
        name,
        voice: typeof c?.voice === "string" ? c.voice : "",
        keyLines: strArr(c?.keyLines).slice(0, 8),
        facts: strArr(c?.facts).slice(0, 8),
      };
    })
    .filter((x): x is ReferenceCharacterCard => !!x);
}

function strArr(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}
