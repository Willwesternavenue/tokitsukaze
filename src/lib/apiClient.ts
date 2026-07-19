"use client";

export type ApiResult<T = any> = {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
};

/**
 * 堅牢な POST。Vercel のタイムアウトページや 502 HTML など、
 * JSON でないレスポンスが返っても落ちないようにする。
 */
export async function postJson<T = any>(
  url: string,
  body: unknown,
): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, status: 0, data: null, error: `通信に失敗しました: ${msg}` };
  }

  const text = await res.text();
  // 空ボディ
  if (!text) {
    return {
      ok: res.ok,
      status: res.status,
      data: null,
      error: res.ok ? null : `HTTP ${res.status} (空のレスポンス)`,
    };
  }

  return interpretResponse<T>(res, text);
}

/** GET 版。ワークフローの状態ポーリングなどに使う。 */
export async function getJson<T = any>(url: string): Promise<ApiResult<T>> {
  let res: Response;
  try {
    // ポーリングはキャッシュ厳禁。no-store に加え、URL にタイムスタンプを付けて
    // ブラウザ/中間キャッシュが古い status（running 等）を返し続けるのを防ぐ。
    const bust = `${url.includes("?") ? "&" : "?"}_ts=${Date.now()}`;
    res = await fetch(url + bust, {
      method: "GET",
      headers: { Accept: "application/json", "Cache-Control": "no-cache" },
      cache: "no-store",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, status: 0, data: null, error: `通信に失敗しました: ${msg}` };
  }
  const text = await res.text();
  if (!text) {
    return {
      ok: res.ok,
      status: res.status,
      data: null,
      error: res.ok ? null : `HTTP ${res.status} (空のレスポンス)`,
    };
  }
  return interpretResponse<T>(res, text);
}

function interpretResponse<T>(res: Response, text: string): ApiResult<T> {
  try {
    const data = JSON.parse(text) as T;
    if (!res.ok) {
      const err =
        typeof (data as any)?.error === "string"
          ? (data as any).error
          : `HTTP ${res.status}`;
      return { ok: false, status: res.status, data, error: err };
    }
    return { ok: true, status: res.status, data, error: null };
  } catch {
    // JSON でない（Vercel のタイムアウトページ、502 HTML、テキストエラー等）
    const looksLikeTimeout =
      /timeout|timed out|FUNCTION_INVOCATION_TIMEOUT/i.test(text) || res.status === 504;
    const looksLikeHtml = /<!doctype|<html/i.test(text.slice(0, 200));
    let humanMsg: string;
    if (looksLikeTimeout) {
      humanMsg = `処理がタイムアウトしました（HTTP ${res.status}）。取材メモが長すぎる、またはサーバ側で時間がかかりすぎた可能性があります。入力を短くするか、しばらく時間をおいて再試行してください。`;
    } else if (looksLikeHtml) {
      humanMsg = `サーバから HTML エラーページが返りました（HTTP ${res.status}）。少し待って再試行してください。`;
    } else {
      humanMsg = `予期しないレスポンス（HTTP ${res.status}）: ${text.slice(0, 200)}`;
    }
    return { ok: false, status: res.status, data: null, error: humanMsg };
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export type RunProgress = "starting" | "pending" | "running";

/**
 * ワークフローを「開始（runId 取得）→ 完了までポーリング」する再利用ヘルパ。
 *
 * これにより、生成処理は 1 リクエストの実行時間（Vercel 関数上限=180s）に縛られず、
 * サーバ側でバックグラウンド実行される。長い素材でも 504 にならない。
 *
 * `startUrl` は `{ runId }` を返すルート。返り値 result はワークフローの returnValue
 * （各ワークフローの結果オブジェクト。呼び出し側で .ok を確認する）。
 */
/**
 * 既に開始済みの run（runId）を完了までポーリングして returnValue を返す。
 * タブ切替・アプリ内移動・リロードからの「復帰（resume）」でも使う。
 * 背景タブで setTimeout が間引かれても、サーバ側の生成は継続しているため、
 * 復帰時にこの関数を呼べば結果を回収できる。
 */
export async function pollRun<T = any>(
  runId: string,
  opts: {
    onProgress?: (status: RunProgress) => void;
    intervalMs?: number;
    timeoutMs?: number;
  } = {},
): Promise<{ ok: true; result: T } | { ok: false; error: string }> {
  const intervalMs = opts.intervalMs ?? 2000;
  // 復帰前提なので長め（サーバ実行は独立。ここで諦めても pending は残せる）
  const timeoutMs = opts.timeoutMs ?? 20 * 60 * 1000;
  const startedAt = Date.now();
  let notFoundStreak = 0;
  while (Date.now() - startedAt < timeoutMs) {
    await sleep(intervalMs);
    const s = await getJson<{ status?: string; result?: T; error?: string; notFound?: boolean }>(
      `/api/workflow-status?runId=${encodeURIComponent(runId)}`,
    );
    if (!s.ok || !s.data) continue; // 一時的な失敗はポーリング継続
    const status = s.data.status;
    if (status === "completed") return { ok: true, result: s.data.result as T };
    if (status === "failed") return { ok: false, error: s.data.error ?? "生成に失敗しました。" };
    if (s.data.notFound) {
      // 開始直後でまだ見えていない可能性。数回は待つ。
      if (++notFoundStreak > 15) {
        return { ok: false, error: "生成タスクが見つかりませんでした。時間をおいて再試行してください。" };
      }
    } else {
      notFoundStreak = 0;
      opts.onProgress?.((status as RunProgress) ?? "running");
    }
  }
  return {
    ok: false,
    error: "生成が時間内に完了しませんでした。時間をおいて再試行してください。",
  };
}

export async function startAndPollRun<T = any>(
  startUrl: string,
  body: unknown,
  opts: {
    onProgress?: (status: RunProgress) => void;
    intervalMs?: number;
    timeoutMs?: number;
  } = {},
): Promise<{ ok: true; result: T } | { ok: false; error: string }> {
  opts.onProgress?.("starting");
  const startRes = await postJson<{ runId?: string }>(startUrl, body);
  if (!startRes.ok) return { ok: false, error: startRes.error ?? "生成の開始に失敗しました。" };
  const runId = startRes.data?.runId;
  if (!runId) return { ok: false, error: "生成を開始できませんでした（runId を取得できませんでした）。" };
  return pollRun<T>(runId, opts);
}
