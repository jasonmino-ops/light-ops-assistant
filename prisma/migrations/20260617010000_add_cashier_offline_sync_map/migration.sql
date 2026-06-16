-- Cashier-Offline-03B: database structure for offline cash order sync idempotency and audit.

-- AlterTable
ALTER TABLE "SaleRecord" ADD COLUMN "source" TEXT,
ADD COLUMN "offlineOrderId" TEXT,
ADD COLUMN "offlineDeviceId" TEXT,
ADD COLUMN "offlineCreatedAtLocal" TEXT,
ADD COLUMN "offlineCreatedAtClientTimestamp" TIMESTAMP(3),
ADD COLUMN "offlineSyncedAt" TIMESTAMP(3),
ADD COLUMN "offlineSyncStatus" TEXT,
ADD COLUMN "inventoryException" TEXT;

-- CreateTable
CREATE TABLE "OfflineSaleSyncMap" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "offlineOrderId" TEXT NOT NULL,
    "saleRecordId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "syncedAt" TIMESTAMP(3),
    "rawPayloadHash" TEXT,
    "lastErrorCode" TEXT,
    "lastErrorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OfflineSaleSyncMap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SaleRecord_source_idx" ON "SaleRecord"("source");

-- CreateIndex
CREATE INDEX "SaleRecord_offlineOrderId_idx" ON "SaleRecord"("offlineOrderId");

-- CreateIndex
CREATE INDEX "SaleRecord_offlineDeviceId_idx" ON "SaleRecord"("offlineDeviceId");

-- CreateIndex
CREATE UNIQUE INDEX "OfflineSaleSyncMap_storeId_deviceId_offlineOrderId_key" ON "OfflineSaleSyncMap"("storeId", "deviceId", "offlineOrderId");

-- CreateIndex
CREATE INDEX "OfflineSaleSyncMap_tenantId_idx" ON "OfflineSaleSyncMap"("tenantId");

-- CreateIndex
CREATE INDEX "OfflineSaleSyncMap_storeId_idx" ON "OfflineSaleSyncMap"("storeId");

-- CreateIndex
CREATE INDEX "OfflineSaleSyncMap_saleRecordId_idx" ON "OfflineSaleSyncMap"("saleRecordId");

-- CreateIndex
CREATE INDEX "OfflineSaleSyncMap_status_idx" ON "OfflineSaleSyncMap"("status");

-- CreateIndex
CREATE INDEX "OfflineSaleSyncMap_createdAt_idx" ON "OfflineSaleSyncMap"("createdAt");

-- AddForeignKey
ALTER TABLE "OfflineSaleSyncMap" ADD CONSTRAINT "OfflineSaleSyncMap_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfflineSaleSyncMap" ADD CONSTRAINT "OfflineSaleSyncMap_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfflineSaleSyncMap" ADD CONSTRAINT "OfflineSaleSyncMap_saleRecordId_fkey" FOREIGN KEY ("saleRecordId") REFERENCES "SaleRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;
