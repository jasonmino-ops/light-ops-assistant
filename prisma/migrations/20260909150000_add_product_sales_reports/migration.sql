-- CreateTable
CREATE TABLE "ProductSalesGroup" (
    "id" TEXT NOT NULL,
    "ownerTelegramId" TEXT NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "selection" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductSalesGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductSalesDailyReport" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "reportDate" VARCHAR(10) NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "result" JSONB NOT NULL,

    CONSTRAINT "ProductSalesDailyReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductSalesGroup_ownerTelegramId_createdAt_idx" ON "ProductSalesGroup"("ownerTelegramId", "createdAt");

-- CreateIndex
CREATE INDEX "ProductSalesGroup_enabled_id_idx" ON "ProductSalesGroup"("enabled", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ProductSalesDailyReport_groupId_reportDate_key" ON "ProductSalesDailyReport"("groupId", "reportDate");

-- AddForeignKey
ALTER TABLE "ProductSalesDailyReport" ADD CONSTRAINT "ProductSalesDailyReport_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ProductSalesGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Application-only access through authenticated OWNER/cron endpoints.
-- No Data API policies: anon/authenticated cannot read or write these tables.
ALTER TABLE "ProductSalesGroup" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductSalesDailyReport" ENABLE ROW LEVEL SECURITY;

-- Application-only group configuration and generated reports (permission class D).
GRANT SELECT, INSERT, UPDATE, DELETE ON public."ProductSalesGroup" TO service_role;
REVOKE ALL ON public."ProductSalesGroup" FROM anon;
REVOKE ALL ON public."ProductSalesGroup" FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."ProductSalesDailyReport" TO service_role;
REVOKE ALL ON public."ProductSalesDailyReport" FROM anon;
REVOKE ALL ON public."ProductSalesDailyReport" FROM authenticated;
