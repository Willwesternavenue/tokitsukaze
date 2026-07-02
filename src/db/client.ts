import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

/**
 * Neon serverless の HTTP driver 版を使う (edge/nodejs 両対応)。
 * DATABASE_URL が未設定なら null を返し、呼び出し側で「DB スキップ」判断させる。
 * これは P1 の姿勢: DB があれば使う、なければ従来通り localStorage のみ。
 */

let cached: ReturnType<typeof buildDb> | null = null;

function buildDb() {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  const sql = neon(url);
  return drizzle(sql, { schema });
}

export function getDb() {
  if (cached === null) cached = buildDb();
  return cached;
}

export function isDbConfigured(): boolean {
  return !!process.env.DATABASE_URL;
}

export { schema };
