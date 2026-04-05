import "dotenv/config";
import { defineConfig, env } from "prisma/config";

/**
 * Prisma 7 config — connection URL split:
 *
 *  DATABASE_URL  → runtime queries (Prisma Client)
 *                  Supabase Transaction-mode pooler, port 6543
 *                  适合 Vercel serverless 高并发
 *
 *  DIRECT_URL    → migrations only (prisma migrate deploy)
 *                  Supabase Direct connection, port 5432
 *                  Advisory lock 需要真实 session，不能走 pooler
 *
 * Prisma 7 的 defineConfig.datasource 不支持 directUrl 字段。
 * 迁移时改用 DATABASE_URL 覆盖为直连地址：
 *
 *   DATABASE_URL="$DIRECT_URL" npx prisma migrate deploy
 *
 * 或直接使用 DIRECT_URL 环境变量：
 *
 *   npx dotenv -e .env -- sh -c \
 *     'DATABASE_URL="$DIRECT_URL" npx prisma migrate deploy'
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});