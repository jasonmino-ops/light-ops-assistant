BEGIN;
CREATE TYPE "CustomerOrderFulfillmentRole" AS ENUM ('KITCHEN', 'FRONT');

CREATE TYPE "CustomerOrderFulfillmentDecision" AS ENUM ('REQUIRED', 'NOT_REQUIRED', 'MANUAL_REVIEW');

CREATE TYPE "CustomerOrderFulfillmentState" AS ENUM (
  'PENDING',
  'RENDER_PENDING',
  'ENQUEUED',
  'FAILED_RETRYABLE',
  'CANCELLED',
  'EXPIRED',
  'MANUAL_REVIEW',
  'NOT_REQUIRED'
);

CREATE TABLE "CustomerOrderFulfillmentIntent" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "orderNo" TEXT NOT NULL,
  "role" "CustomerOrderFulfillmentRole" NOT NULL,
  "source" VARCHAR(32) NOT NULL DEFAULT 'H5_HOME',
  "schemaVersion" INTEGER NOT NULL DEFAULT 3,
  "decision" "CustomerOrderFulfillmentDecision" NOT NULL,
  "state" "CustomerOrderFulfillmentState" NOT NULL,
  "snapshotJson" TEXT NOT NULL,
  "snapshotHash" CHAR(64) NOT NULL,
  "payloadBase64" TEXT,
  "byteLength" INTEGER,
  "payloadHash" CHAR(64),
  "rendererVersion" TEXT,
  "sealedAt" TIMESTAMP(3),
  "idempotencyKey" TEXT NOT NULL,
  "paymentIntentId" TEXT,
  "paymentEventAt" TIMESTAMP(3),
  "confirmedAt" TIMESTAMP(3),
  "paidAt" TIMESTAMP(3),
  "deadlineAt" TIMESTAMP(3) NOT NULL,
  "printJobId" TEXT,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 12,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL,
  "lastRecoverySweepAt" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  "lastErrorAt" TIMESTAMP(3),
  "manualReviewReason" TEXT,
  "cancelResultCode" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CustomerOrderFulfillmentIntent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomerOrderFulfillmentIntent_scope_role_key"
  ON "CustomerOrderFulfillmentIntent"("tenantId", "storeId", "orderNo", "role");

CREATE INDEX "CustomerOrderFulfillmentIntent_recovery_idx"
  ON "CustomerOrderFulfillmentIntent"("tenantId", "storeId", "state", "nextAttemptAt", "id");

CREATE INDEX "CustomerOrderFulfillmentIntent_source_recovery_idx"
  ON "CustomerOrderFulfillmentIntent"("source", "state", "nextAttemptAt", "id");

CREATE INDEX "CustomerOrderFulfillmentIntent_sweep_idx"
  ON "CustomerOrderFulfillmentIntent"("tenantId", "storeId", "source", "lastRecoverySweepAt", "id");

CREATE INDEX "CustomerOrderFulfillmentIntent_job_idx"
  ON "CustomerOrderFulfillmentIntent"("tenantId", "storeId", "printJobId");

CREATE INDEX "CustomerOrderFulfillmentIntent_payment_idx"
  ON "CustomerOrderFulfillmentIntent"("tenantId", "storeId", "paymentIntentId");

-- Server-internal fulfillment ledger: no client/Data API access or policies.
-- IDs are application-generated TEXT; this table owns no sequence requiring a
-- separate revoke. Indexes and its composite type do not grant table access.
ALTER TABLE public."CustomerOrderFulfillmentIntent" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public."CustomerOrderFulfillmentIntent" FROM PUBLIC;

-- Plain PostgreSQL test instances need not have Supabase's API roles. Revoke
-- only existing roles, without changing global defaults or other tables.
DO $intent_permissions$
DECLARE
  api_role text;
BEGIN
  FOR api_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated')
  LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public."CustomerOrderFulfillmentIntent" FROM %I', api_role);
  END LOOP;
END
$intent_permissions$;

COMMIT;
