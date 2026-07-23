-- EP-ID-POLICY-01: server-side Browser POS Device lifecycle.
-- Existing pos-device-v1 tokens are registered lazily on first valid use;
-- this migration does not delete or rewrite existing OperationLog data.

CREATE TYPE "BrowserPosDeviceStatus" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED');

CREATE TABLE "BrowserPosDevice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "browserDeviceId" TEXT NOT NULL,
    "status" "BrowserPosDeviceStatus" NOT NULL DEFAULT 'ACTIVE',
    "activeSlot" TEXT DEFAULT 'ACTIVE',
    "tokenHash" TEXT NOT NULL,
    "tokenHashVersion" INTEGER NOT NULL DEFAULT 1,
    "tokenIssuedAt" TIMESTAMP(3) NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "scopes" JSONB NOT NULL,
    "issuedByUserId" TEXT,
    "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" TEXT,
    "revocationReason" TEXT,
    "legacyMigratedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrowserPosDevice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BrowserPosDevice_tokenHash_key" ON "BrowserPosDevice"("tokenHash");
CREATE UNIQUE INDEX "BrowserPosDevice_storeId_browserDeviceId_activeSlot_key" ON "BrowserPosDevice"("storeId", "browserDeviceId", "activeSlot");
CREATE INDEX "BrowserPosDevice_tenantId_storeId_idx" ON "BrowserPosDevice"("tenantId", "storeId");
CREATE INDEX "BrowserPosDevice_storeId_status_idx" ON "BrowserPosDevice"("storeId", "status");
CREATE INDEX "BrowserPosDevice_browserDeviceId_idx" ON "BrowserPosDevice"("browserDeviceId");
CREATE INDEX "BrowserPosDevice_tokenExpiresAt_idx" ON "BrowserPosDevice"("tokenExpiresAt");
CREATE INDEX "BrowserPosDevice_issuedByUserId_idx" ON "BrowserPosDevice"("issuedByUserId");
CREATE INDEX "BrowserPosDevice_revokedByUserId_idx" ON "BrowserPosDevice"("revokedByUserId");

ALTER TABLE "BrowserPosDevice" ADD CONSTRAINT "BrowserPosDevice_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BrowserPosDevice" ADD CONSTRAINT "BrowserPosDevice_storeId_fkey"
  FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BrowserPosDevice" ADD CONSTRAINT "BrowserPosDevice_issuedByUserId_fkey"
  FOREIGN KEY ("issuedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BrowserPosDevice" ADD CONSTRAINT "BrowserPosDevice_revokedByUserId_fkey"
  FOREIGN KEY ("revokedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Device transactions keep their required legacy operator FK for compatibility,
-- while these fields preserve the actual device principal for audit and review.
ALTER TABLE "SaleRecord" ADD COLUMN "transactionActorType" TEXT,
ADD COLUMN "transactionActorId" TEXT,
ADD COLUMN "authorizedByUserId" TEXT;
CREATE INDEX "SaleRecord_transactionActorType_transactionActorId_idx" ON "SaleRecord"("transactionActorType", "transactionActorId");

ALTER TABLE "PaymentIntent" ADD COLUMN "transactionActorType" TEXT,
ADD COLUMN "transactionActorId" TEXT,
ADD COLUMN "authorizedByUserId" TEXT;
CREATE INDEX "PaymentIntent_transactionActorType_transactionActorId_idx" ON "PaymentIntent"("transactionActorType", "transactionActorId");

ALTER TABLE "MemberBalanceLedger" ADD COLUMN "transactionActorType" TEXT,
ADD COLUMN "transactionActorId" TEXT,
ADD COLUMN "authorizedByUserId" TEXT;
CREATE INDEX "MemberBalanceLedger_transactionActorType_transactionActorId_idx" ON "MemberBalanceLedger"("transactionActorType", "transactionActorId");

ALTER TABLE "CustomerOrder" ADD COLUMN "transactionActorType" TEXT,
ADD COLUMN "transactionActorId" TEXT,
ADD COLUMN "authorizedByUserId" TEXT;
CREATE INDEX "CustomerOrder_transactionActorType_transactionActorId_idx" ON "CustomerOrder"("transactionActorType", "transactionActorId");
