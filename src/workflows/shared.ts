/**
 * WDK P1 の共通ヘルパ。
 * 現在の generation 実装（generateJsonWithRetry + prompt テンプレ）を
 * step から素直に呼び出せる形にラップする。
 *
 * P2 以降でここに Proofreader / Reader Experience 等の step を追加していく。
 * P1 では単純ラッパで、動作品質を維持したまま基盤だけ WDK に載せる。
 */

import { AIConfigError, currentProvider, generateJsonWithRetry } from "@/lib/ai";
import type { ChatMessage } from "@/lib/ai";

export type StepAiInput = {
  messages: ChatMessage[];
  maxTokens?: number;
  maxAttempts?: number;
};

export type StepAiResult<T> = {
  parsed: T | null;
  raw: string;
  attempts: number;
  model: string;
  provider: string;
};

/**
 * step から呼ばれる AI 実行ヘルパ。generateJsonWithRetry を薄くラップして、
 * P2 以降で model/prompt version を残しやすいよう補足情報も返す。
 */
export async function runAiStep<T>(
  input: StepAiInput,
  parser: (raw: string) => T | null,
): Promise<StepAiResult<T>> {
  try {
    const provider = currentProvider();
    const model =
      provider === "anthropic"
        ? process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001"
        : process.env.OPENAI_MODEL || "gpt-4o-mini";
    const result = await generateJsonWithRetry(input.messages, parser, {
      maxTokens: input.maxTokens,
      maxAttempts: input.maxAttempts,
    });
    return {
      parsed: result.parsed,
      raw: result.raw,
      attempts: result.attempts,
      model,
      provider,
    };
  } catch (e) {
    if (e instanceof AIConfigError) throw e;
    throw e;
  }
}
