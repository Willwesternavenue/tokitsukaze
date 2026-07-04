import { NextResponse } from "next/server";
import { getRun } from "workflow/api";

export const runtime = "nodejs";

/**
 * ワークフロー実行の状態ポーリング用エンドポイント。
 *
 * 生成系ルートは start() 後すぐに { runId } を返すため、クライアントはここを
 * ポーリングして完了を待つ。これにより 1 リクエストの実行時間上限（=504）から
 * 切り離され、長い生成でもタイムアウトしない。
 *
 * status: pending | running | completed | failed | cancelled
 *   - completed → returnValue（各ワークフローの結果）を result に載せて返す
 *   - failed/cancelled → クライアントに再試行を促す
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const runId = searchParams.get("runId");
  if (!runId) {
    return NextResponse.json({ error: "runId が必要です。" }, { status: 400 });
  }

  try {
    const run = getRun(runId);
    const status = await run.status;

    if (status === "completed") {
      const result = await run.returnValue;
      return NextResponse.json({ status: "completed", result });
    }
    if (status === "failed" || status === "cancelled") {
      return NextResponse.json({
        status: "failed",
        error: "生成処理が失敗しました。しばらく時間をおいて再試行してください。",
      });
    }
    // pending | running
    return NextResponse.json({ status });
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    const msg = e instanceof Error ? e.message : String(e);
    // 開始直後は run がまだ見えないことがある。notFound はポーリング継続扱いにする。
    if (/NotFound/i.test(name) || /not.?found/i.test(msg)) {
      return NextResponse.json({ status: "pending", notFound: true });
    }
    console.error("[workflow-status] error", msg);
    return NextResponse.json({ status: "failed", error: `実行状態を取得できませんでした：${msg}` });
  }
}
