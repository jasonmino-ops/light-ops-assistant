BEGIN;
-- Additive public-submission identity. Existing orders remain all-NULL; no backfill.
-- The successful receipt is committed together with CustomerOrder and coupon redemption.
ALTER TABLE "CustomerOrder"
  ADD COLUMN "submissionKey" VARCHAR(64),
  ADD COLUMN "submissionHash" CHAR(64),
  ADD COLUMN "submissionVersion" INTEGER,
  ADD COLUMN "submissionResponse" JSONB;

CREATE UNIQUE INDEX "CustomerOrder_submission_key"
  ON "CustomerOrder" ("tenantId", "storeId", "submissionKey");

ALTER TABLE "CustomerOrder" ADD CONSTRAINT "CustomerOrder_submission_complete_check" CHECK (
  ("submissionKey" IS NULL AND "submissionHash" IS NULL
    AND "submissionVersion" IS NULL AND "submissionResponse" IS NULL)
  OR
  ("submissionKey" IS NOT NULL AND "submissionHash" IS NOT NULL
    AND "submissionVersion" IS NOT NULL AND "submissionResponse" IS NOT NULL
    AND "submissionKey" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND "submissionHash" ~ '^[0-9a-f]{64}$'
    AND "submissionVersion" = 1
    AND jsonb_typeof("submissionResponse") = 'object'
    AND "submissionResponse" ? 'orderNo'
    AND jsonb_typeof("submissionResponse" -> 'orderNo') = 'string'
    AND "submissionResponse" ->> 'orderNo' = "orderNo"
    AND "submissionResponse" ? 'totalAmount'
    AND jsonb_typeof("submissionResponse" -> 'totalAmount') = 'number')
);

COMMIT;
