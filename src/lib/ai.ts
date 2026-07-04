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
// 計画系（構成・小見出し・質問）は高速モデルを既定にする。env で上書き可。
const DEFAULT_OPENAI_FAST_MODEL = "gpt-4o-mini";
const DEFAULT_ANTHROPIC_FAST_MODEL = "claude-haiku-4-5-20251001";

/** AI 応答が制限時間内に返らなかったことを表す。Vercel の 504 になる前に打ち切るために使う。 */
export class AITimeoutError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "AITimeoutError";
  }
}

/**
 * 構成案・小見出し・事前質問など「計画・構造化」タスク向けの高速モデル。
 * 出力量が多く遅くなりがちな工程を高速モデルに寄せて 504 を防ぐ。
 */
export function planningModel(): string {
  return getProvider() === "anthropic"
    ? process.env.ANTHROPIC_MODEL_FAST || DEFAULT_ANTHROPIC_FAST_MODEL
    : process.env.OPENAI_MODEL_FAST || DEFAULT_OPENAI_FAST_MODEL;
}

/** 本文・レビューなど品質重視タスク向けの既定モデル。 */
export function mainModel(): string {
  return getProvider() === "anthropic"
    ? process.env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL
    : process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
}

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
  opts: { maxTokens?: number; temperature?: number; model?: string; timeoutMs?: number } = {},
): Promise<string> {
  const provider = getProvider();
  const maxTokens = opts.maxTokens ?? 4096;
  // JSON生成は揺らぎを抑えるため低温度を既定にする
  const temperature = opts.temperature ?? 0.2;

  // 制限時間で中断できるようにする（Vercel の関数上限＝504 に達する前に打ち切る）。
  // 併せてストリーミングで受けることで、長い応答でも接続を保ちつつ逐次受信する。
  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs && opts.timeoutMs > 0 ? opts.timeoutMs : undefined;
  const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null;
  const timeoutMsg = () =>
    `AI応答が制限時間（約${Math.round((timeoutMs ?? 0) / 1000)}秒）内に完了しませんでした。入力（素材）を短くするか、しばらく時間をおいて再試行してください。`;

  try {
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
      const model = opts.model || process.env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL;
      let text = "";
      let stopReason: string | null = null;
      try {
        const stream = (await client.messages.create(
          {
            model,
            max_tokens: maxTokens,
            temperature,
            system: sys ? `${sys}\n\n${jsonRule}` : jsonRule,
            messages: userAndAssistant,
            stream: true,
          },
          { signal: controller.signal },
        )) as AsyncIterable<any>;
        for await (const event of stream) {
          if (event?.type === "content_block_delta" && event.delta?.type === "text_delta") {
            text += event.delta.text ?? "";
          } else if (event?.type === "message_delta" && event.delta?.stop_reason) {
            stopReason = event.delta.stop_reason;
          }
        }
      } catch (e) {
        if (controller.signal.aborted) throw new AITimeoutError(timeoutMsg());
        throw e;
      }
      if (stopReason === "max_tokens") {
        console.warn(
          `[ai] anthropic ${model} hit max_tokens (${maxTokens}). 出力が途中で切れた可能性があります。`,
        );
      }
      console.log(`[ai] anthropic ${model} stop_reason=${stopReason} chars=${text.length}`);
      return text;
    }

    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new AIConfigError("OPENAI_API_KEY が設定されていません。");
    const client = new OpenAI({ apiKey: key });
    const model = opts.model || process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
    let text = "";
    let finish: string | null | undefined = null;
    try {
      const stream = (await client.chat.completions.create(
        {
          model,
          response_format: { type: "json_object" },
          temperature,
          max_tokens: maxTokens,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          stream: true,
        },
        { signal: controller.signal },
      )) as AsyncIterable<any>;
      for await (const chunk of stream) {
        text += chunk?.choices?.[0]?.delta?.content ?? "";
        const fr = chunk?.choices?.[0]?.finish_reason;
        if (fr) finish = fr;
      }
    } catch (e) {
      if (controller.signal.aborted) throw new AITimeoutError(timeoutMsg());
      throw e;
    }
    if (finish === "length") {
      console.warn(`[ai] openai ${model} hit max_tokens (${maxTokens}). 出力が切れた可能性があります。`);
    }
    console.log(`[ai] openai ${model} finish_reason=${finish} chars=${text.length}`);
    return text;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * generateJson にリトライ機能を付けたヘルパ。
 * parser が null を返した場合、AI に「前回出力は JSON として解釈できなかった」
 * と伝えて再生成させる。最大 maxAttempts 回まで試行。
 */
export async function generateJsonWithRetry<T>(
  messages: ChatMessage[],
  parser: (raw: string) => T | null,
  opts: {
    maxTokens?: number;
    temperature?: number;
    maxAttempts?: number;
    model?: string;
    /** 全試行を合わせた総制限時間(ms)。Vercel の関数上限(180s)より短くして 504 を防ぐ。 */
    totalTimeoutMs?: number;
  } = {},
): Promise<{ parsed: T | null; raw: string; attempts: number; timedOut?: boolean }> {
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 2);
  const totalTimeoutMs = opts.totalTimeoutMs && opts.totalTimeoutMs > 0 ? opts.totalTimeoutMs : 165000;
  const startedAt = Date.now();
  const remaining = () => totalTimeoutMs - (Date.now() - startedAt);
  let currentMessages = messages;
  let lastRaw = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const budget = remaining();
    // 残り時間が僅少なら新たな試行を始めない（504 を避ける）
    if (attempt > 1 && budget < 20000) {
      console.warn(`[ai] 残り時間 ${budget}ms のため試行 ${attempt} をスキップします。`);
      break;
    }
    let raw: string;
    try {
      raw = await generateJson(currentMessages, {
        maxTokens: opts.maxTokens,
        temperature: opts.temperature,
        model: opts.model,
        timeoutMs: Math.max(1000, budget),
      });
    } catch (e) {
      if (e instanceof AITimeoutError) {
        console.warn(`[ai] attempt ${attempt}/${maxAttempts}: 時間切れで打ち切り。`);
        return { parsed: null, raw: lastRaw, attempts: attempt, timedOut: true };
      }
      throw e;
    }
    lastRaw = raw;
    const parsed = parser(raw);
    if (parsed !== null) {
      if (attempt > 1) console.log(`[ai] parse success on attempt ${attempt}`);
      return { parsed, raw, attempts: attempt };
    }
    console.warn(
      `[ai] attempt ${attempt}/${maxAttempts}: 出力をパースできず。リトライします。`,
    );
    if (attempt < maxAttempts) {
      currentMessages = [
        ...messages,
        { role: "assistant", content: raw.slice(0, 2000) },
        {
          role: "user",
          content:
            "前回の出力は JSON として解釈できませんでした。" +
            "説明文・前置き・後書き・コードフェンスを一切付けず、" +
            "`{` から始まり `}` で終わる純粋で valid な JSON オブジェクトのみを、改めて1つだけ出力してください。",
        },
      ];
    }
  }
  return { parsed: null, raw: lastRaw, attempts: maxAttempts };
}

export function currentProvider(): AIProvider {
  return getProvider();
}

export function hasApiKey(): boolean {
  const p = getProvider();
  if (p === "anthropic") return !!process.env.ANTHROPIC_API_KEY;
  return !!process.env.OPENAI_API_KEY;
}
