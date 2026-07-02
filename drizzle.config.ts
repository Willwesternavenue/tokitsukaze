import type { Config } from "drizzle-kit";

/**
 * Neon Postgres 用の Drizzle 設定。
 * DATABASE_URL は Vercel Marketplace の Neon integration が自動注入する。
 * ローカル開発時は .env.local に DATABASE_URL を書く。
 *
 * Usage:
 *   npx drizzle-kit generate    // schema からマイグレーション SQL を作成
 *   npx drizzle-kit migrate     // DB にマイグレーションを適用
 *   npx drizzle-kit studio      // ブラウザで DB を閲覧
 */
export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
} satisfies Config;
