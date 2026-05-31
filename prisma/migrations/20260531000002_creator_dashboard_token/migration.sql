-- Add dashboard token fields to Creator
ALTER TABLE "Creator"
  ADD COLUMN IF NOT EXISTS "dashboardToken"          TEXT,
  ADD COLUMN IF NOT EXISTS "dashboardTokenCreatedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "dashboardTokenRevokedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "Creator_dashboardToken_key"
  ON "Creator"("dashboardToken");

-- Record migration
INSERT INTO "_prisma_migrations" (
  id, checksum, finished_at, migration_name, logs, rolled_back_at,
  started_at, applied_steps_count
)
SELECT
  gen_random_uuid()::text,
  '0000000000000000000000000000000000000000000000000000000000000000',
  now(), '20260531000002_creator_dashboard_token', NULL, NULL, now(), 1
WHERE NOT EXISTS (
  SELECT 1 FROM "_prisma_migrations"
  WHERE migration_name = '20260531000002_creator_dashboard_token'
);
