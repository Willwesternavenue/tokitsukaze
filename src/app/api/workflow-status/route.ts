import { NextResponse } from "next/server";
import { getRun } from "workflow/api";

export const runtime = "nodejs";
// ポーリング用エンドポイント。絶対にキャッシュさせない。
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

const NO_STORE = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
} as const;

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: NO_STORE });
}

/**
 * ワークフロー実行の状態ポーリング用エンドポイント。
 *
 * 生成系ルートは start() 後すぐに { runId } を返すため、クライアントはここを
 * ポーリングして完了を待つ。これにより 1 リクエストの実行時間上限（=504）から
 * 切り離される。
 *
 * 重要: レスポンスは必ず no-store。ここがキャッシュされると、クライアントは
 * 古い "running" を受け取り続けて完了を検知できず、生成が止まって見える。
 *
 * status: pending | running | completed | failed | cancelled
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const runId = searchParams.get("runId");
  if (!runId) {
    return json({ error: "runId が必要です。" }, 400);
  }

  try {
    const run = getRun(runId);
    const status = await run.status;

    if (status === "completed") {
      const result = await run.returnValue;
      return json({ status: "completed", result });
    }
    if (status === "failed" || status === "cancelled") {
      return json({
        status: "failed",
        error: "生成処理が失敗しました。しばらく時間をおいて再試行してください。",
      });
    }
    // pending | running
    return json({ status });
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    const msg = e instanceof Error ? e.message : String(e);
    // 開始直後は run がまだ見えないことがある。notFound はポーリング継続扱いにする。
    if (/NotFound/i.test(name) || /not.?found/i.test(msg)) {
      return json({ status: "pending", notFound: true });
    }
    console.error("[workflow-status] error", msg);
    return json({ status: "failed", error: `実行状態を取得できませんでした：${msg}` });
  }
}
