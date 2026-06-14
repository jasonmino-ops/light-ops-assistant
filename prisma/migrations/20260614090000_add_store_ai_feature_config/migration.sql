-- CreateTable
CREATE TABLE "StoreAiFeatureConfig" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "featureKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "dailyLimitOverride" INTEGER,
    "trialUntil" TIMESTAMP(3),
    "opsNote" TEXT,
    "updatedByOpsAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreAiFeatureConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StoreAiFeatureConfig_tenantId_storeId_featureKey_key" ON "StoreAiFeatureConfig"("tenantId", "storeId", "featureKey");

-- CreateIndex
CREATE INDEX "StoreAiFeatureConfig_tenantId_idx" ON "StoreAiFeatureConfig"("tenantId");

-- CreateIndex
CREATE INDEX "StoreAiFeatureConfig_storeId_idx" ON "StoreAiFeatureConfig"("storeId");

-- AddForeignKey
ALTER TABLE "StoreAiFeatureConfig" ADD CONSTRAINT "StoreAiFeatureConfig_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreAiFeatureConfig" ADD CONSTRAINT "StoreAiFeatureConfig_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
