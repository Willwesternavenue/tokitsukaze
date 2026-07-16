import { NextResponse, type NextRequest } from "next/server";
import { GATE_COOKIE, gateConfig, verifyToken } from "@/lib/gate";

/**
 * サイト全体の合言葉ゲート。
 * - 認証Cookieが有効なら通す。無効ならページは /gate へ、API は 401。
 * - 合言葉(env)が未設定ならゲート無効（従来どおり公開）。
 * - Workflow SDK の内部エンドポイント(/.well-known/*)はサーバ間通信なので除外（生成が壊れないように）。
 */

export const config = {
  // 静的アセット・画像・favicon 等は対象外
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)"],
};

function isExempt(pathname: string): boolean {
  return (
    pathname === "/gate" ||
    pathname === "/api/gate" ||
    pathname.startsWith("/.well-known/") // Workflow SDK のstep/webhook
  );
}

export async function middleware(req: NextRequest) {
  const cfg = gateConfig();
  if (!cfg.enabled) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (isExempt(pathname)) return NextResponse.next();

  const token = req.cookies.get(GATE_COOKIE)?.value;
  const role = await verifyToken(token, cfg.secret);
  if (role) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "この操作には合言葉が必要です。トップページで合言葉を入力してください。" },
      { status: 401 },
    );
  }

  const url = req.nextUrl.clone();
  url.pathname = "/gate";
  url.search = "";
  if (pathname && pathname !== "/") url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}
