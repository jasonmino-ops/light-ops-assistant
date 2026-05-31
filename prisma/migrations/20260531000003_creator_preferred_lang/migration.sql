-- Add preferredLang to Creator
ALTER TABLE "Creator"
  ADD COLUMN IF NOT EXISTS "preferredLang" TEXT;

-- Record migration
INSERT INTO "_prisma_migrations" (
  id, checksum, finished_at, migration_name, logs, rolled_back_at,
  started_at, applied_steps_count
)
SELECT
  gen_random_uuid()::text,
  '0000000000000000000000000000000000000000000000000000000000000000',
  now(), '20260531000003_creator_preferred_lang', NULL, NULL, now(), 1
WHERE NOT EXISTS (
  SELECT 1 FROM "_prisma_migrations"
  WHERE migration_name = '20260531000003_creator_preferred_lang'
);
