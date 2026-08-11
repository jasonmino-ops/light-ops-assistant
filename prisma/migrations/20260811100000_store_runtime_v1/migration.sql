-- E-Shop Store Runtime V1.0: one printer binding and a minimal Cloud task ledger.
CREATE TABLE "StoreRuntimePrinterBinding" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL DEFAULT 'WINDOWS_QUEUE',
    "printerName" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreRuntimePrinterBinding_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StoreRuntimePrintTask" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "bindingId" TEXT NOT NULL,
    "bindingVersion" INTEGER NOT NULL,
    "printerName" TEXT NOT NULL,
    "taskType" TEXT NOT NULL DEFAULT 'PRINT_RECEIPT',
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "idempotencyKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "claimedByDeviceId" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "acceptedAt" TIMESTAMP(3),
    "executingAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "resultStatus" TEXT,
    "resultCode" TEXT,
    "resultMessage" TEXT,
    "effectBoundary" TEXT,
    "physicalCompletionKnown" BOOLEAN,
    "resultDetails" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreRuntimePrintTask_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StoreRuntimePrinterBinding_storeId_key" ON "StoreRuntimePrinterBinding"("storeId");
CREATE INDEX "StoreRuntimePrinterBinding_tenantId_storeId_idx" ON "StoreRuntimePrinterBinding"("tenantId", "storeId");
CREATE INDEX "StoreRuntimePrinterBinding_enabled_idx" ON "StoreRuntimePrinterBinding"("enabled");

CREATE UNIQUE INDEX "StoreRuntimePrintTask_storeId_idempotencyKey_key" ON "StoreRuntimePrintTask"("storeId", "idempotencyKey");
CREATE INDEX "StoreRuntimePrintTask_tenantId_storeId_status_createdAt_idx" ON "StoreRuntimePrintTask"("tenantId", "storeId", "status", "createdAt");
CREATE INDEX "StoreRuntimePrintTask_storeId_status_leaseExpiresAt_idx" ON "StoreRuntimePrintTask"("storeId", "status", "leaseExpiresAt");
CREATE INDEX "StoreRuntimePrintTask_claimedByDeviceId_status_idx" ON "StoreRuntimePrintTask"("claimedByDeviceId", "status");
CREATE INDEX "StoreRuntimePrintTask_bindingId_idx" ON "StoreRuntimePrintTask"("bindingId");

ALTER TABLE "StoreRuntimePrinterBinding" ADD CONSTRAINT "StoreRuntimePrinterBinding_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoreRuntimePrinterBinding" ADD CONSTRAINT "StoreRuntimePrinterBinding_storeId_tenantId_fkey"
    FOREIGN KEY ("storeId", "tenantId") REFERENCES "Store"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StoreRuntimePrintTask" ADD CONSTRAINT "StoreRuntimePrintTask_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoreRuntimePrintTask" ADD CONSTRAINT "StoreRuntimePrintTask_storeId_tenantId_fkey"
    FOREIGN KEY ("storeId", "tenantId") REFERENCES "Store"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoreRuntimePrintTask" ADD CONSTRAINT "StoreRuntimePrintTask_bindingId_fkey"
    FOREIGN KEY ("bindingId") REFERENCES "StoreRuntimePrinterBinding"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StoreRuntimePrintTask" ADD CONSTRAINT "StoreRuntimePrintTask_claimedByDeviceId_fkey"
    FOREIGN KEY ("claimedByDeviceId") REFERENCES "DesktopDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
