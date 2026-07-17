-- EP-MB3-06A Cloud Desktop Activation Identity.
-- Independent from legacy POS authorization, BindToken, OperationLog payload snapshots,
-- Electron runtime, and local-first Desktop storage.

CREATE TYPE "DesktopDeviceStatus" AS ENUM ('ACTIVE', 'REVOKED');
CREATE TYPE "DesktopActivationPinStatus" AS ENUM ('ACTIVE', 'USED', 'REVOKED', 'EXPIRED');

CREATE TABLE "DesktopDevice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "installationIdHash" TEXT NOT NULL,
    "status" "DesktopDeviceStatus" NOT NULL DEFAULT 'ACTIVE',
    "activeSlot" TEXT DEFAULT 'ACTIVE',
    "tokenHash" TEXT NOT NULL,
    "tokenHashVersion" INTEGER NOT NULL DEFAULT 1,
    "tokenIssuedAt" TIMESTAMP(3) NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "tokenLastUsedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" TEXT,
    "revocationReason" TEXT,
    "replacesDeviceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DesktopDevice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DesktopActivationPin" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "pinHash" TEXT NOT NULL,
    "pinHashVersion" INTEGER NOT NULL DEFAULT 1,
    "status" "DesktopActivationPinStatus" NOT NULL DEFAULT 'ACTIVE',
    "activeSlot" TEXT DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "usedByDeviceId" TEXT,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DesktopActivationPin_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DesktopActivationAudit" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "deviceId" TEXT,
    "pinId" TEXT,
    "actorUserId" TEXT,
    "eventType" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "reasonCode" TEXT,
    "ipHash" TEXT,
    "userAgentHash" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DesktopActivationAudit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DesktopDevice_tokenHash_key" ON "DesktopDevice"("tokenHash");
CREATE UNIQUE INDEX "DesktopDevice_installationIdHash_activeSlot_key" ON "DesktopDevice"("installationIdHash", "activeSlot");
CREATE INDEX "DesktopDevice_tenantId_storeId_idx" ON "DesktopDevice"("tenantId", "storeId");
CREATE INDEX "DesktopDevice_storeId_status_idx" ON "DesktopDevice"("storeId", "status");
CREATE INDEX "DesktopDevice_installationIdHash_idx" ON "DesktopDevice"("installationIdHash");
CREATE INDEX "DesktopDevice_tokenExpiresAt_idx" ON "DesktopDevice"("tokenExpiresAt");
CREATE INDEX "DesktopDevice_revokedByUserId_idx" ON "DesktopDevice"("revokedByUserId");
CREATE INDEX "DesktopDevice_replacesDeviceId_idx" ON "DesktopDevice"("replacesDeviceId");

CREATE UNIQUE INDEX "DesktopActivationPin_storeId_activeSlot_key" ON "DesktopActivationPin"("storeId", "activeSlot");
CREATE INDEX "DesktopActivationPin_tenantId_storeId_idx" ON "DesktopActivationPin"("tenantId", "storeId");
CREATE INDEX "DesktopActivationPin_expiresAt_idx" ON "DesktopActivationPin"("expiresAt");
CREATE INDEX "DesktopActivationPin_usedByDeviceId_idx" ON "DesktopActivationPin"("usedByDeviceId");
CREATE INDEX "DesktopActivationPin_createdByUserId_idx" ON "DesktopActivationPin"("createdByUserId");
CREATE INDEX "DesktopActivationPin_status_idx" ON "DesktopActivationPin"("status");

CREATE INDEX "DesktopActivationAudit_tenantId_createdAt_idx" ON "DesktopActivationAudit"("tenantId", "createdAt");
CREATE INDEX "DesktopActivationAudit_storeId_createdAt_idx" ON "DesktopActivationAudit"("storeId", "createdAt");
CREATE INDEX "DesktopActivationAudit_deviceId_createdAt_idx" ON "DesktopActivationAudit"("deviceId", "createdAt");
CREATE INDEX "DesktopActivationAudit_pinId_createdAt_idx" ON "DesktopActivationAudit"("pinId", "createdAt");
CREATE INDEX "DesktopActivationAudit_actorUserId_createdAt_idx" ON "DesktopActivationAudit"("actorUserId", "createdAt");
CREATE INDEX "DesktopActivationAudit_eventType_createdAt_idx" ON "DesktopActivationAudit"("eventType", "createdAt");
CREATE INDEX "DesktopActivationAudit_result_createdAt_idx" ON "DesktopActivationAudit"("result", "createdAt");

ALTER TABLE "DesktopDevice" ADD CONSTRAINT "DesktopDevice_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DesktopDevice" ADD CONSTRAINT "DesktopDevice_storeId_fkey"
  FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DesktopDevice" ADD CONSTRAINT "DesktopDevice_revokedByUserId_fkey"
  FOREIGN KEY ("revokedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DesktopDevice" ADD CONSTRAINT "DesktopDevice_replacesDeviceId_fkey"
  FOREIGN KEY ("replacesDeviceId") REFERENCES "DesktopDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DesktopActivationPin" ADD CONSTRAINT "DesktopActivationPin_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DesktopActivationPin" ADD CONSTRAINT "DesktopActivationPin_storeId_fkey"
  FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DesktopActivationPin" ADD CONSTRAINT "DesktopActivationPin_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DesktopActivationPin" ADD CONSTRAINT "DesktopActivationPin_usedByDeviceId_fkey"
  FOREIGN KEY ("usedByDeviceId") REFERENCES "DesktopDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DesktopActivationAudit" ADD CONSTRAINT "DesktopActivationAudit_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DesktopActivationAudit" ADD CONSTRAINT "DesktopActivationAudit_storeId_fkey"
  FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DesktopActivationAudit" ADD CONSTRAINT "DesktopActivationAudit_deviceId_fkey"
  FOREIGN KEY ("deviceId") REFERENCES "DesktopDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DesktopActivationAudit" ADD CONSTRAINT "DesktopActivationAudit_pinId_fkey"
  FOREIGN KEY ("pinId") REFERENCES "DesktopActivationPin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DesktopActivationAudit" ADD CONSTRAINT "DesktopActivationAudit_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
