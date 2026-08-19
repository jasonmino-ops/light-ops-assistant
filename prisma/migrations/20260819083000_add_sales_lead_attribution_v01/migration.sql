-- ES-SALES-LEAD-01 — minimal social lead attribution and sales follow-up.
--
-- Production pre-gate completed before this migration was authored:
-- StoreApplication PENDING rows: 1; duplicate telegramId groups: 0.
-- The migration intentionally performs no historical backfill and no data repair.

-- CreateEnum
CREATE TYPE "AcquisitionSourceChannel" AS ENUM ('FACEBOOK', 'TIKTOK', 'SALES', 'POSTER', 'TELEGRAM', 'OTHER', 'DIRECT_TELEGRAM');

-- CreateEnum
CREATE TYPE "AcquisitionInviteStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "SalesLeadStatus" AS ENUM ('NEW', 'FOLLOWING', 'WAITING_TELEGRAM', 'APPLIED', 'ACTIVATED', 'LOST');

-- CreateEnum
CREATE TYPE "SalesLeadTokenPurpose" AS ENUM ('APPLICATION', 'SUPPORT');

-- CreateEnum
CREATE TYPE "SalesLeadRateAction" AS ENUM ('LEAD_SUBMIT', 'APPLICANT_CLAIM', 'APPLICATION_SUBMIT');

-- CreateEnum
CREATE TYPE "SalesLeadRateScope" AS ENUM ('PHONE', 'TELEGRAM', 'INVITE', 'IP', 'APPLICATION_TOKEN');

-- CreateTable
CREATE TABLE "AcquisitionInvite" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "sourceChannel" "AcquisitionSourceChannel" NOT NULL,
    "campaignLabel" TEXT,
    "salesOwnerId" TEXT,
    "internalNote" TEXT,
    "status" "AcquisitionInviteStatus" NOT NULL DEFAULT 'ACTIVE',
    "visitCount" INTEGER NOT NULL DEFAULT 0,
    "firstVisitAt" TIMESTAMP(3),
    "lastVisitAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AcquisitionInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesLead" (
    "id" TEXT NOT NULL,
    "storeName" TEXT NOT NULL,
    "ownerName" TEXT NOT NULL,
    "normalizedPhone" TEXT NOT NULL,
    "address" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "firstInviteId" TEXT,
    "firstSourceChannel" "AcquisitionSourceChannel" NOT NULL,
    "firstCampaign" TEXT,
    "initialSalesOwnerId" TEXT,
    "telegramId" TEXT,
    "telegramUsername" TEXT,
    "telegramFirstName" TEXT,
    "telegramLastName" TEXT,
    "telegramBoundAt" TIMESTAMP(3),
    "status" "SalesLeadStatus" NOT NULL DEFAULT 'WAITING_TELEGRAM',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesLeadContextToken" (
    "id" TEXT NOT NULL,
    "salesLeadId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "purpose" "SalesLeadTokenPurpose" NOT NULL,
    "contextStage" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "consumedByTelegramId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesLeadContextToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationBlock" (
    "id" TEXT NOT NULL,
    "telegramId" TEXT NOT NULL,
    "telegramUsername" TEXT,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "blockedByOpsAdminId" TEXT NOT NULL,
    "blockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unblockedByOpsAdminId" TEXT,
    "unblockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApplicationBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesLeadRateCounter" (
    "id" TEXT NOT NULL,
    "action" "SalesLeadRateAction" NOT NULL,
    "scopeType" "SalesLeadRateScope" NOT NULL,
    "scopeKeyHash" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesLeadRateCounter_pkey" PRIMARY KEY ("id")
);

-- AlterTable: nullable linkage only; historical rows remain null.
ALTER TABLE "StoreApplication"
ADD COLUMN "salesLeadId" TEXT,
ADD COLUMN "createdStoreId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "AcquisitionInvite_code_key" ON "AcquisitionInvite"("code");
CREATE INDEX "AcquisitionInvite_status_createdAt_idx" ON "AcquisitionInvite"("status", "createdAt");
CREATE INDEX "AcquisitionInvite_salesOwnerId_status_idx" ON "AcquisitionInvite"("salesOwnerId", "status");

CREATE INDEX "SalesLead_normalizedPhone_idx" ON "SalesLead"("normalizedPhone");
CREATE INDEX "SalesLead_telegramId_idx" ON "SalesLead"("telegramId");
CREATE INDEX "SalesLead_firstInviteId_createdAt_idx" ON "SalesLead"("firstInviteId", "createdAt");
CREATE INDEX "SalesLead_initialSalesOwnerId_status_idx" ON "SalesLead"("initialSalesOwnerId", "status");
CREATE INDEX "SalesLead_status_lastActivityAt_idx" ON "SalesLead"("status", "lastActivityAt");

CREATE UNIQUE INDEX "SalesLeadContextToken_tokenHash_key" ON "SalesLeadContextToken"("tokenHash");
CREATE INDEX "SalesLeadContextToken_salesLeadId_purpose_expiresAt_idx" ON "SalesLeadContextToken"("salesLeadId", "purpose", "expiresAt");
CREATE INDEX "SalesLeadToken_support_context_idx" ON "SalesLeadContextToken"("purpose", "consumedByTelegramId", "consumedAt");
CREATE INDEX "SalesLeadContextToken_expiresAt_idx" ON "SalesLeadContextToken"("expiresAt");

CREATE UNIQUE INDEX "ApplicationBlock_telegramId_key" ON "ApplicationBlock"("telegramId");
CREATE INDEX "ApplicationBlock_unblockedAt_blockedAt_idx" ON "ApplicationBlock"("unblockedAt", "blockedAt");

CREATE UNIQUE INDEX "SalesLeadRateCounter_window_key" ON "SalesLeadRateCounter"("action", "scopeType", "scopeKeyHash", "windowStart");
CREATE INDEX "SalesLeadRateCounter_expiresAt_idx" ON "SalesLeadRateCounter"("expiresAt");

CREATE UNIQUE INDEX "StoreApplication_createdStoreId_key" ON "StoreApplication"("createdStoreId");
CREATE INDEX "StoreApplication_telegramId_status_idx" ON "StoreApplication"("telegramId", "status");
CREATE INDEX "StoreApplication_salesLeadId_createdAt_idx" ON "StoreApplication"("salesLeadId", "createdAt");

-- Database-level serverless concurrency guards. These are intentionally
-- expressed as reviewed PostgreSQL partial indexes rather than application-only checks.
CREATE UNIQUE INDEX "StoreApplication_one_pending_per_telegram"
ON "StoreApplication"("telegramId")
WHERE "status" = 'PENDING';

CREATE UNIQUE INDEX "SalesLead_one_inflight_per_telegram"
ON "SalesLead"("telegramId")
WHERE "telegramId" IS NOT NULL
  AND "status" IN ('NEW', 'FOLLOWING', 'WAITING_TELEGRAM', 'APPLIED');

-- AddForeignKey
ALTER TABLE "AcquisitionInvite" ADD CONSTRAINT "AcquisitionInvite_salesOwnerId_fkey" FOREIGN KEY ("salesOwnerId") REFERENCES "OpsAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SalesLead" ADD CONSTRAINT "SalesLead_firstInviteId_fkey" FOREIGN KEY ("firstInviteId") REFERENCES "AcquisitionInvite"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SalesLead" ADD CONSTRAINT "SalesLead_initialSalesOwnerId_fkey" FOREIGN KEY ("initialSalesOwnerId") REFERENCES "OpsAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SalesLeadContextToken" ADD CONSTRAINT "SalesLeadContextToken_salesLeadId_fkey" FOREIGN KEY ("salesLeadId") REFERENCES "SalesLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApplicationBlock" ADD CONSTRAINT "ApplicationBlock_blockedByOpsAdminId_fkey" FOREIGN KEY ("blockedByOpsAdminId") REFERENCES "OpsAdmin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ApplicationBlock" ADD CONSTRAINT "ApplicationBlock_unblockedByOpsAdminId_fkey" FOREIGN KEY ("unblockedByOpsAdminId") REFERENCES "OpsAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StoreApplication" ADD CONSTRAINT "StoreApplication_salesLeadId_fkey" FOREIGN KEY ("salesLeadId") REFERENCES "SalesLead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StoreApplication" ADD CONSTRAINT "StoreApplication_createdStoreId_fkey" FOREIGN KEY ("createdStoreId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Supabase permissions: all five new tables contain system state or Lead PII.
-- Public/customer access must go through server APIs; direct anon/authenticated access is denied.
GRANT SELECT, INSERT, UPDATE, DELETE ON public."AcquisitionInvite" TO service_role;
REVOKE ALL ON public."AcquisitionInvite" FROM anon;
REVOKE ALL ON public."AcquisitionInvite" FROM authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public."SalesLead" TO service_role;
REVOKE ALL ON public."SalesLead" FROM anon;
REVOKE ALL ON public."SalesLead" FROM authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public."SalesLeadContextToken" TO service_role;
REVOKE ALL ON public."SalesLeadContextToken" FROM anon;
REVOKE ALL ON public."SalesLeadContextToken" FROM authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public."ApplicationBlock" TO service_role;
REVOKE ALL ON public."ApplicationBlock" FROM anon;
REVOKE ALL ON public."ApplicationBlock" FROM authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public."SalesLeadRateCounter" TO service_role;
REVOKE ALL ON public."SalesLeadRateCounter" FROM anon;
REVOKE ALL ON public."SalesLeadRateCounter" FROM authenticated;
