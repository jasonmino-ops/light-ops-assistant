/**
 * lib/prisma.ts
 *
 * Single Prisma client singleton for the entire process.
 *
 * BUG FIXED: the previous version only wrote to globalThis in development,
 * so every production (Vercel) request created a new PrismaPg adapter
 * (= new pg.Pool) and a new PrismaClient — exhausting Supabase's session
 * mode connection limit ("MaxClientsInSessionMode / max clients reached").
 *
 * Fix: always write to globalThis in both dev and prod.
 *      One pg.Pool per process, shared across all requests on the same
 *      warm serverless instance.
 *
 * Pool sizing: max=2 is enough for serverless.  Each Vercel function
 * instance handles requests serially; 2 connections covers the rare case
 * where a single handler fires multiple parallel Prisma queries.
 *
 * Supabase note: if you still hit connection limits, switch DATABASE_URL
 * port from 5432 (session mode) to 6543 (transaction mode) in Vercel's
 * environment variables.  Transaction mode handles far more concurrent
 * serverless clients.
 */

import "dotenv/config";
import pg from "pg";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Typed global cache — survives Next.js hot-reload in dev and warm starts in prod.
const g = globalThis as typeof globalThis & { _prisma?: PrismaClient };

function createPrismaClient(): PrismaClient {
  // Create an explicit pg.Pool so we can cap connections per serverless instance.
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL!,
    max: 2,                        // cap per-instance connections
    idleTimeoutMillis: 10_000,     // release idle connections quickly
    connectionTimeoutMillis: 5_000, // fail fast instead of hanging
  });

  const adapter = new PrismaPg(pool);

  return new PrismaClient({
    adapter,
    log: ["error"],
  });
}

// ??= creates the client exactly once per process.
export const prisma = (g._prisma ??= createPrismaClient());
