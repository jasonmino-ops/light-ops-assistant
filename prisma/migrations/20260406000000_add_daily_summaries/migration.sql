-- CreateTable
CREATE TABLE "TenantDailySummary" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "salesCount" INTEGER NOT NULL DEFAULT 0,
    "refundCount" INTEGER NOT NULL DEFAULT 0,
    "grossSales" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "refundAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "netSales" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantDailySummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreDailySummary" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "salesCount" INTEGER NOT NULL DEFAULT 0,
    "refundCount" INTEGER NOT NULL DEFAULT 0,
    "grossSales" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "refundAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "netSales" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreDailySummary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TenantDailySummary_tenantId_date_key" ON "TenantDailySummary"("tenantId", "date");

-- CreateIndex
CREATE INDEX "TenantDailySummary_date_idx" ON "TenantDailySummary"("date");

-- CreateIndex
CREATE UNIQUE INDEX "StoreDailySummary_storeId_date_key" ON "StoreDailySummary"("storeId", "date");

-- CreateIndex
CREATE INDEX "StoreDailySummary_tenantId_date_idx" ON "StoreDailySummary"("tenantId", "date");
