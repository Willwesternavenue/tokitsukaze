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
 * Anthropic は OpenAI のような json_object モードがないため、
 * assistant 側に "{" をプレフィル (先置き) して JSON 出力を強制する。
 * 返り値はプレフィル分も含めた完全なテキスト。
 */
export async function generateJson(
  messages: ChatMessage[],
  opts: { maxTokens?: number; prefill?: string } = {},
): Promise<string> {
  const provider = getProvider();
  const maxTokens = opts.maxTokens ?? 4096;
  const prefill = opts.prefill ?? "{";

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
    // prefill: assistantメッセージの末尾に "{" を置くと、続きの出力が必ずJSONとして始まる
    userAndAssistant.push({ role: "assistant", content: prefill });

    const model = process.env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL;
    const res = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system: sys
        ? `${sys}\n\n出力は必ず純粋なJSONのみ。説明文・コードフェンス・前置きは禁止。`
        : "出力は必ず純粋なJSONのみ。説明文・コードフェンス・前置きは禁止。",
      messages: userAndAssistant,
    });
    const text = res.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("");
    const full = `${prefill}${text}`;
    if (res.stop_reason === "max_tokens") {
      console.warn(
        `[ai] anthropic ${model} hit max_tokens (${maxTokens}). 出力が途中で切れた可能性があります。`,
      );
    }
    console.log(
      `[ai] anthropic ${model} stop_reason=${res.stop_reason} chars=${full.length}`,
    );
    return full;
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
