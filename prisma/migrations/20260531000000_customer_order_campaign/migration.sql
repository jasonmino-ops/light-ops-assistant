-- Add campaign attribution fields to CustomerOrder
ALTER TABLE "CustomerOrder"
  ADD COLUMN IF NOT EXISTS "sourcePlatform" TEXT,
  ADD COLUMN IF NOT EXISTS "campaignCode"   TEXT,
  ADD COLUMN IF NOT EXISTS "campaignLinkId" TEXT,
  ADD COLUMN IF NOT EXISTS "campaignIntent" TEXT;

CREATE INDEX IF NOT EXISTS "CustomerOrder_campaignLinkId_idx"
  ON "CustomerOrder" ("campaignLinkId");

-- Record migration
INSERT INTO "_prisma_migrations" (
  id, checksum, finished_at, migration_name, logs, rolled_back_at,
  started_at, applied_steps_count
)
SELECT
  gen_random_uuid()::text,
  '0000000000000000000000000000000000000000000000000000000000000000',
  now(), '20260531000000_customer_order_campaign', NULL, NULL, now(), 1
WHERE NOT EXISTS (
  SELECT 1 FROM "_prisma_migrations"
  WHERE migration_name = '20260531000000_customer_order_campaign'
);
