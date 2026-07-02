import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

/**
 * Neon serverless の HTTP driver 版を使う (edge/nodejs 両対応)。
 * DATABASE_URL が未設定なら null を返し、呼び出し側で「DB スキップ」判断させる。
 * これは P1 の姿勢: DB があれば使う、なければ従来通り localStorage のみ。
 */

let cached: ReturnType<typeof buildDb> | null = null;

function resolveDbUrl(): string | undefined {
  // Vercel Marketplace の Neon integration は POSTGRES_URL 等の名前で env を作る。
  // 手動設定にも対応するため、DATABASE_URL も候補に含めて先勝ちで選ぶ。
  const candidates = [
    process.env.DATABASE_URL,
    process.env.POSTGRES_URL,
    process.env.POSTGRES_PRISMA_URL,
    process.env.DATABASE_URL_UNPOOLED,
    process.env.POSTGRES_URL_NON_POOLING,
  ];
  return candidates.find((v) => typeof v === "string" && v.length > 0);
}

function buildDb() {
  const url = resolveDbUrl();
  if (!url) return null;
  const sql = neon(url);
  return drizzle(sql, { schema });
}

export function getDb() {
  if (cached === null) cached = buildDb();
  return cached;
}

export function isDbConfigured(): boolean {
  return !!resolveDbUrl();
}

export { schema };
