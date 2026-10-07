BEGIN;
-- Only the H5 internal ledger; preserve the previous migration and RLS/ACL.
ALTER TABLE "CustomerOrderFulfillmentIntent"
  ADD COLUMN "renderProfileId" TEXT,
  ADD COLUMN "renderAttemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "renderLeaseOwnerId" TEXT,
  ADD COLUMN "renderLeaseTokenHash" CHAR(64),
  ADD COLUMN "renderLeaseExpiresAt" TIMESTAMP(3),
  ADD CONSTRAINT "CustomerOrderFulfillmentIntent_render_count_check"
    CHECK ("renderAttemptCount" >= 0),
  ADD CONSTRAINT "CustomerOrderFulfillmentIntent_render_lease_check"
    CHECK (("renderLeaseOwnerId" IS NULL AND "renderLeaseTokenHash" IS NULL AND "renderLeaseExpiresAt" IS NULL)
      OR ("renderLeaseOwnerId" IS NOT NULL AND "renderLeaseTokenHash" IS NOT NULL AND "renderLeaseExpiresAt" IS NOT NULL)),
  ADD CONSTRAINT "CustomerOrderFulfillmentIntent_render_token_check"
    CHECK ("renderLeaseTokenHash" IS NULL OR "renderLeaseTokenHash" ~ '^[0-9a-f]{64}$');

CREATE INDEX "CustomerOrderFulfillmentIntent_render_owner_idx"
  ON "CustomerOrderFulfillmentIntent" ("renderLeaseOwnerId", "renderLeaseExpiresAt");

COMMIT;
