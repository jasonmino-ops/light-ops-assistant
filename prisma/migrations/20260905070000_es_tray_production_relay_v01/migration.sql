-- ES-PRINT-DUAL-CHANNEL-01 / Channel A Production Relay V0.1
--
-- The FIELD migration 20260811160000 is already applied in Production and
-- created empty StoreRuntime* tables. This migration deliberately leaves those
-- tables untouched and creates a separate production ledger.

CREATE TYPE "EshopTrayPrintJobStatus" AS ENUM (
    'PENDING',
    'CLAIMED',
    'EXECUTING',
    'SUCCEEDED',
    'FAILED',
    'EXPIRED'
);

CREATE TABLE "EshopTrayPrintJob" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL,
    "status" "EshopTrayPrintJobStatus" NOT NULL DEFAULT 'PENDING',
    "claimedByComputerBindingId" TEXT,
    "claimTokenHash" CHAR(64),
    "claimAttempt" INTEGER NOT NULL DEFAULT 0,
    "leaseExpiresAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "executingAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "resultStatus" TEXT,
    "resultCode" TEXT,
    "resultMessage" TEXT,
    "effectBoundary" TEXT,
    "physicalCompletionKnown" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EshopTrayPrintJob_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "EshopTrayPrintJob_requestHash_check" CHECK ("requestHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "EshopTrayPrintJob_claimTokenHash_check" CHECK ("claimTokenHash" IS NULL OR "claimTokenHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "EshopTrayPrintJob_attempts_check" CHECK ("claimAttempt" >= 0 AND "attemptCount" >= 0 AND "maxAttempts" > 0),
    CONSTRAINT "EshopTrayPrintJob_effectBoundary_check" CHECK ("effectBoundary" IS NULL OR "effectBoundary" IN ('NOT_CROSSED', 'CROSSING_UNKNOWN', 'CROSSED')),
    CONSTRAINT "EshopTrayPrintJob_physicalCompletionKnown_check" CHECK ("physicalCompletionKnown" = false),
    CONSTRAINT "EshopTrayPrintJob_activeClaim_check" CHECK (
      "status" NOT IN ('CLAIMED', 'EXECUTING')
      OR (
        "claimedByComputerBindingId" IS NOT NULL
        AND "claimTokenHash" IS NOT NULL
        AND "claimAttempt" > 0
        AND "leaseExpiresAt" IS NOT NULL
      )
    )
);

CREATE UNIQUE INDEX "EshopTrayPrintJob_claimTokenHash_key"
    ON "EshopTrayPrintJob"("claimTokenHash");

CREATE UNIQUE INDEX "EshopTrayPrintJob_tenantId_storeId_idempotencyKey_key"
    ON "EshopTrayPrintJob"("tenantId", "storeId", "idempotencyKey");

CREATE UNIQUE INDEX "ComputerBinding_id_tenantId_storeId_key"
    ON "ComputerBinding"("id", "tenantId", "storeId");

CREATE INDEX "EshopTrayPrintJob_tenantId_storeId_status_nextAttemptAt_cre_idx"
    ON "EshopTrayPrintJob"("tenantId", "storeId", "status", "nextAttemptAt", "createdAt");

CREATE INDEX "EshopTrayPrintJob_status_leaseExpiresAt_idx"
    ON "EshopTrayPrintJob"("status", "leaseExpiresAt");

CREATE INDEX "EshopTrayPrintJob_claimedByComputerBindingId_status_idx"
    ON "EshopTrayPrintJob"("claimedByComputerBindingId", "status");

CREATE INDEX "EshopTrayPrintJob_tenantId_storeId_expiresAt_idx"
    ON "EshopTrayPrintJob"("tenantId", "storeId", "expiresAt");

ALTER TABLE "EshopTrayPrintJob"
    ADD CONSTRAINT "EshopTrayPrintJob_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EshopTrayPrintJob"
    ADD CONSTRAINT "EshopTrayPrintJob_storeId_tenantId_fkey"
    FOREIGN KEY ("storeId", "tenantId") REFERENCES "Store"("id", "tenantId")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EshopTrayPrintJob"
    ADD CONSTRAINT "EshopTrayPrintJob_claimedByComputerBindingId_tenantId_stor_fkey"
    FOREIGN KEY ("claimedByComputerBindingId", "tenantId", "storeId")
    REFERENCES "ComputerBinding"("id", "tenantId", "storeId")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- The relay is server-only. Keep the new public-schema table unavailable to
-- Data API roles even if the Supabase project exposes new public tables.
ALTER TABLE "EshopTrayPrintJob" ENABLE ROW LEVEL SECURITY;
