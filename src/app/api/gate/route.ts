import { NextResponse } from "next/server";
import {
  GATE_COOKIE,
  GATE_MAX_AGE,
  GATE_ROLE_COOKIE,
  createToken,
  gateConfig,
  roleForPasscode,
} from "@/lib/gate";

export const runtime = "nodejs";

/** 合言葉を検証してセッションCookieを発行する */
export async function POST(req: Request) {
  const cfg = gateConfig();
  if (!cfg.enabled) {
    // ゲート無効時は誰でも通す（envが未設定＝公開運用）
    return NextResponse.json({ ok: true, role: "staff", disabled: true });
  }

  let body: { passcode?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "リクエストが不正です。" }, { status: 400 });
  }

  const role = roleForPasscode(body.passcode ?? "", cfg);
  if (!role) {
    return NextResponse.json({ error: "合言葉が違います。" }, { status: 401 });
  }

  const token = await createToken(role, cfg.secret);
  const res = NextResponse.json({ ok: true, role });
  const secure = process.env.NODE_ENV === "production";
  const base = {
    path: "/",
    maxAge: GATE_MAX_AGE,
    sameSite: "lax" as const,
    secure,
  };
  // 認証本体（改ざん不可・JSから読めない）
  res.cookies.set(GATE_COOKIE, token, { ...base, httpOnly: true });
  // 表示用のロール（バッジ用。セキュリティには使わない）
  res.cookies.set(GATE_ROLE_COOKIE, role, { ...base, httpOnly: false });
  return res;
}

/** ログアウト（Cookieを消す） */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(GATE_COOKIE, "", { path: "/", maxAge: 0 });
  res.cookies.set(GATE_ROLE_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
