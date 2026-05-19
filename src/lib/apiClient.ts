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

  // JSON として読めるか試す
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
      /timeout|timed out|FUNCTION_INVOCATION_TIMEOUT/i.test(text) ||
      res.status === 504;
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
