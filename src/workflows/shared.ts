/**
 * WDK P1 の共通ヘルパ。
 * 現在の generation 実装（generateJsonWithRetry + prompt テンプレ）を
 * step から素直に呼び出せる形にラップする。
 *
 * P2 以降でここに Proofreader / Reader Experience 等の step を追加していく。
 * P1 では単純ラッパで、動作品質を維持したまま基盤だけ WDK に載せる。
 */

import { AIConfigError, currentProvider, generateJsonWithRetry, mainModel } from "@/lib/ai";
import type { ChatMessage } from "@/lib/ai";

export type StepAiInput = {
  messages: ChatMessage[];
  maxTokens?: number;
  maxAttempts?: number;
  /** モデルの明示指定。計画系ステップは planningModel() を渡して高速化する。 */
  model?: string;
  /** 全試行合計の制限時間(ms)。未指定なら generateJsonWithRetry の既定(165s)。 */
  timeoutMs?: number;
};

export type StepAiResult<T> = {
  parsed: T | null;
  raw: string;
  attempts: number;
  model: string;
  provider: string;
  /** 制限時間切れで打ち切った場合 true（呼び出し側でメッセージを出し分ける） */
  timedOut?: boolean;
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
    const model = input.model || mainModel();
    const result = await generateJsonWithRetry(input.messages, parser, {
      maxTokens: input.maxTokens,
      maxAttempts: input.maxAttempts,
      model: input.model,
      totalTimeoutMs: input.timeoutMs,
    });
    return {
      parsed: result.parsed,
      raw: result.raw,
      attempts: result.attempts,
      model,
      provider,
      timedOut: result.timedOut,
    };
  } catch (e) {
    if (e instanceof AIConfigError) throw e;
    throw e;
  }
}
