-- Create Creator table
CREATE TABLE IF NOT EXISTS "Creator" (
  "id"           TEXT          NOT NULL,
  "tenantId"     TEXT          NOT NULL,
  "storeId"      TEXT          NOT NULL,
  "name"         TEXT          NOT NULL,
  "displayName"  TEXT,
  "phone"        TEXT,
  "telegramId"   TEXT,
  "tiktokHandle" TEXT,
  "note"         TEXT,
  "status"       TEXT          NOT NULL DEFAULT 'active',
  "createdAt"    TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Creator_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Creator_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "Creator_storeId_idx"  ON "Creator"("storeId");
CREATE INDEX IF NOT EXISTS "Creator_tenantId_idx" ON "Creator"("tenantId");

-- Extend CampaignLink: creator + commission + settlement
ALTER TABLE "CampaignLink"
  ADD COLUMN IF NOT EXISTS "creatorId"        TEXT,
  ADD COLUMN IF NOT EXISTS "commissionType"   TEXT,
  ADD COLUMN IF NOT EXISTS "commissionValue"  DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS "settlementStatus" TEXT NOT NULL DEFAULT 'unsettled',
  ADD COLUMN IF NOT EXISTS "settledAt"        TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "settledNote"      TEXT;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'CampaignLink_creatorId_fkey'
      AND table_name = 'CampaignLink'
  ) THEN
    ALTER TABLE "CampaignLink"
      ADD CONSTRAINT "CampaignLink_creatorId_fkey"
      FOREIGN KEY ("creatorId") REFERENCES "Creator"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "CampaignLink_creatorId_idx" ON "CampaignLink"("creatorId");

-- Record migration
INSERT INTO "_prisma_migrations" (
  id, checksum, finished_at, migration_name, logs, rolled_back_at,
  started_at, applied_steps_count
)
SELECT
  gen_random_uuid()::text,
  '0000000000000000000000000000000000000000000000000000000000000000',
  now(), '20260531000001_creator_commission', NULL, NULL, now(), 1
WHERE NOT EXISTS (
  SELECT 1 FROM "_prisma_migrations"
  WHERE migration_name = '20260531000001_creator_commission'
);
