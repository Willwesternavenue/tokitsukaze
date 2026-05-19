import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

export type AIProvider = "openai" | "anthropic";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export class AIConfigError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "AIConfigError";
  }
}

function getProvider(): AIProvider {
  const p = (process.env.AI_PROVIDER || "openai").toLowerCase();
  if (p === "anthropic" || p === "claude") return "anthropic";
  return "openai";
}

const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";

/**
 * Provider-agnostic text completion. Always asks for JSON output.
 *
 * Anthropic は OpenAI のような json_object モードがない。
 * 一部の新しいモデル (Sonnet 4.6 など) は assistant prefill を拒否するため、
 * システムプロンプトで JSON 出力を強制する方式に統一する。
 * 出力の前後に説明文が混じった場合は呼び出し側の safeJsonParse がコードフェンスや
 * 余計な文字を除去して JSON を抽出する。
 */
export async function generateJson(
  messages: ChatMessage[],
  opts: { maxTokens?: number } = {},
): Promise<string> {
  const provider = getProvider();
  const maxTokens = opts.maxTokens ?? 4096;

  if (provider === "anthropic") {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new AIConfigError("ANTHROPIC_API_KEY が設定されていません。");
    const client = new Anthropic({ apiKey: key });
    const sys = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const userAndAssistant = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
        content: m.content,
      }));
    if (userAndAssistant.length === 0) {
      userAndAssistant.push({ role: "user", content: "出力を生成してください。" });
    }

    const jsonRule =
      "【出力ルール（必ず厳守）】\n" +
      "1. 出力は JSON オブジェクトのみ。先頭文字は必ず `{`、末尾文字は必ず `}`。\n" +
      "2. 説明文・前置き・後書き・コードフェンス（```）は一切付けない。\n" +
      "3. JSON は valid な構文で、文字列内の改行は \\n でエスケープする。\n" +
      "4. キーや値が長くなっても、JSON 構造を最後まで閉じきること。";
    const model = process.env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL;
    const res = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system: sys ? `${sys}\n\n${jsonRule}` : jsonRule,
      messages: userAndAssistant,
    });
    const text = res.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("");
    if (res.stop_reason === "max_tokens") {
      console.warn(
        `[ai] anthropic ${model} hit max_tokens (${maxTokens}). 出力が途中で切れた可能性があります。`,
      );
    }
    console.log(
      `[ai] anthropic ${model} stop_reason=${res.stop_reason} chars=${text.length}`,
    );
    return text;
  }

  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new AIConfigError("OPENAI_API_KEY が設定されていません。");
  const client = new OpenAI({ apiKey: key });
  const model = process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
  const res = await client.chat.completions.create({
    model,
    response_format: { type: "json_object" },
    max_tokens: maxTokens,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  });
  const text = res.choices[0]?.message?.content ?? "";
  const finish = res.choices[0]?.finish_reason;
  if (finish === "length") {
    console.warn(`[ai] openai ${model} hit max_tokens (${maxTokens}). 出力が切れた可能性があります。`);
  }
  console.log(`[ai] openai ${model} finish_reason=${finish} chars=${text.length}`);
  return text;
}

export function currentProvider(): AIProvider {
  return getProvider();
}

export function hasApiKey(): boolean {
  const p = getProvider();
  if (p === "anthropic") return !!process.env.ANTHROPIC_API_KEY;
  return !!process.env.OPENAI_API_KEY;
}
