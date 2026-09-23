CREATE TABLE "V3PrintControlPlane" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "ownerDeviceId" TEXT,
  "ownerEpoch" INTEGER NOT NULL DEFAULT 0,
  "leaseId" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "mode" VARCHAR(24) NOT NULL DEFAULT 'V2_ACTIVE',
  "stateVersion" INTEGER NOT NULL DEFAULT 1,
  "handoffRequestedAt" TIMESTAMP(3),
  "handoffQuarantineUntil" TIMESTAMP(3),
  "lastReconciledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "V3PrintControlPlane_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "V3PrintControlPlane_owner_epoch_check" CHECK ("ownerEpoch" >= 0),
  CONSTRAINT "V3PrintControlPlane_state_version_check" CHECK ("stateVersion" >= 1),
  CONSTRAINT "V3PrintControlPlane_mode_check" CHECK ("mode" IN ('V2_ACTIVE', 'V2_DRAINING', 'V3_ACTIVE', 'V3_DRAINING', 'BLOCKED_UNKNOWN')),
  CONSTRAINT "V3PrintControlPlane_owner_shape_check" CHECK (
    ("ownerDeviceId" IS NULL AND "leaseId" IS NULL AND "leaseExpiresAt" IS NULL)
    OR ("ownerDeviceId" IS NOT NULL AND "leaseId" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL)
  )
);

CREATE TABLE "V3PrintExecutionBatch" (
  "id" TEXT NOT NULL,
  "controlPlaneId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "ownerDeviceId" TEXT NOT NULL,
  "ownerEpoch" INTEGER NOT NULL,
  "stateVersion" INTEGER NOT NULL,
  "leaseId" TEXT NOT NULL,
  "mode" VARCHAR(24) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "V3PrintExecutionBatch_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "V3PrintExecutionBatch_owner_epoch_check" CHECK ("ownerEpoch" >= 1),
  CONSTRAINT "V3PrintExecutionBatch_state_version_check" CHECK ("stateVersion" >= 1),
  CONSTRAINT "V3PrintExecutionBatch_mode_check" CHECK ("mode" = 'V3_ACTIVE'),
  CONSTRAINT "V3PrintExecutionBatch_expiry_check" CHECK ("expiresAt" > "createdAt")
);

CREATE UNIQUE INDEX "V3PrintControlPlane_storeId_key" ON "V3PrintControlPlane"("storeId");
CREATE UNIQUE INDEX "DesktopDevice_id_tenantId_storeId_key" ON "DesktopDevice"("id", "tenantId", "storeId");
CREATE UNIQUE INDEX "V3PrintControlPlane_leaseId_key" ON "V3PrintControlPlane"("leaseId");
CREATE UNIQUE INDEX "V3PrintControlPlane_id_tenantId_storeId_key" ON "V3PrintControlPlane"("id", "tenantId", "storeId");
CREATE UNIQUE INDEX "V3PrintControlPlane_storeId_tenantId_key" ON "V3PrintControlPlane"("storeId", "tenantId");
CREATE INDEX "V3PrintControlPlane_tenantId_storeId_mode_idx" ON "V3PrintControlPlane"("tenantId", "storeId", "mode");
CREATE INDEX "V3PrintControlPlane_ownerDeviceId_ownerEpoch_idx" ON "V3PrintControlPlane"("ownerDeviceId", "ownerEpoch");
CREATE INDEX "V3PrintControlPlane_leaseExpiresAt_idx" ON "V3PrintControlPlane"("leaseExpiresAt");
CREATE INDEX "V3PrintExecutionBatch_tenantId_storeId_ownerDeviceId_ownerEpoch_idx" ON "V3PrintExecutionBatch"("tenantId", "storeId", "ownerDeviceId", "ownerEpoch");
CREATE INDEX "V3PrintExecutionBatch_controlPlaneId_stateVersion_idx" ON "V3PrintExecutionBatch"("controlPlaneId", "stateVersion");
CREATE INDEX "V3PrintExecutionBatch_expiresAt_idx" ON "V3PrintExecutionBatch"("expiresAt");

ALTER TABLE "V3PrintControlPlane" ADD CONSTRAINT "V3PrintControlPlane_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "V3PrintControlPlane" ADD CONSTRAINT "V3PrintControlPlane_storeId_tenantId_fkey" FOREIGN KEY ("storeId", "tenantId") REFERENCES "Store"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "V3PrintControlPlane" ADD CONSTRAINT "V3PrintControlPlane_ownerDeviceId_tenantId_storeId_fkey" FOREIGN KEY ("ownerDeviceId", "tenantId", "storeId") REFERENCES "DesktopDevice"("id", "tenantId", "storeId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "V3PrintExecutionBatch" ADD CONSTRAINT "V3PrintExecutionBatch_controlPlaneId_tenantId_storeId_fkey" FOREIGN KEY ("controlPlaneId", "tenantId", "storeId") REFERENCES "V3PrintControlPlane"("id", "tenantId", "storeId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "V3PrintExecutionBatch" ADD CONSTRAINT "V3PrintExecutionBatch_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "V3PrintExecutionBatch" ADD CONSTRAINT "V3PrintExecutionBatch_storeId_tenantId_fkey" FOREIGN KEY ("storeId", "tenantId") REFERENCES "Store"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "V3PrintExecutionBatch" ADD CONSTRAINT "V3PrintExecutionBatch_ownerDeviceId_tenantId_storeId_fkey" FOREIGN KEY ("ownerDeviceId", "tenantId", "storeId") REFERENCES "DesktopDevice"("id", "tenantId", "storeId") ON DELETE RESTRICT ON UPDATE CASCADE;
