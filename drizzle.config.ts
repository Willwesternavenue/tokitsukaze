import type { Config } from "drizzle-kit";
import { config } from "dotenv";

// drizzle-kit は Next.js と違い .env.local を自動で読まないので、明示的にロードする
config({ path: ".env.local" });
config({ path: ".env" });

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
