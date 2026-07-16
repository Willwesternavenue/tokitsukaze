/**
 * アクセスゲート（合言葉）の共通ロジック。
 * middleware（edge runtime）と /api/gate（node）の両方から使うため、
 * Node固有APIは使わず Web Crypto のみで実装している。
 *
 * 仕組み:
 *  - 合言葉は環境変数 STAFF_PASSCODE / GUEST_PASSCODE（コードに埋め込まない）
 *  - 認証Cookie(gate_session) は `role.exp.署名` の HMAC-SHA256 署名付き（改ざん不可）
 *  - どちらの合言葉も未設定ならゲートは無効（従来どおり公開）
 */

export type GateRole = "staff" | "guest";

export const GATE_COOKIE = "gate_session";
/** バッジ表示用（httpOnlyでない・セキュリティ用途ではない） */
export const GATE_ROLE_COOKIE = "gate_role";
export const GATE_MAX_AGE = 60 * 60 * 24 * 30; // 30日

export function gateConfig(): {
  staff: string;
  guest: string;
  secret: string;
  enabled: boolean;
} {
  const staff = process.env.STAFF_PASSCODE?.trim() || "";
  const guest = process.env.GUEST_PASSCODE?.trim() || "";
  const explicit = process.env.GATE_SECRET?.trim() || "";
  // GATE_SECRET 推奨。未設定なら合言葉から導出（合言葉を知らない限りトークンは偽造できない）
  const secret = explicit || `akikaze-gate|${staff}|${guest}`;
  return { staff, guest, secret, enabled: !!(staff || guest) };
}

/** 入力された合言葉がどちらのロールか判定（一致しなければ null） */
export function roleForPasscode(passcode: string, cfg = gateConfig()): GateRole | null {
  const p = passcode.trim();
  if (!p) return null;
  if (cfg.staff && p === cfg.staff) return "staff";
  if (cfg.guest && p === cfg.guest) return "guest";
  return null;
}

function b64urlFromBytes(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return b64urlFromBytes(new Uint8Array(sig));
}

export async function createToken(role: GateRole, secret: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + GATE_MAX_AGE;
  const payload = `${role}.${exp}`;
  const sig = await hmac(secret, payload);
  return `${payload}.${sig}`;
}

/** トークンを検証し、有効ならロールを返す（無効・期限切れ・改ざんは null） */
export async function verifyToken(
  token: string | undefined,
  secret: string,
): Promise<GateRole | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [role, expStr, sig] = parts;
  if (role !== "staff" && role !== "guest") return null;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return null;
  const expected = await hmac(secret, `${role}.${expStr}`);
  if (expected.length !== sig.length) return null;
  // 定数時間比較
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff !== 0) return null;
  return role;
}
