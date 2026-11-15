-- CustomerOrder predated the checked-in campaign ALTER migration. Initialize
-- only an absent relation, using the original shape and current column contract.
-- This does not alter or backfill a previously provisioned CustomerOrder table.
BEGIN;

DO $$
BEGIN
  IF pg_catalog.to_regclass('public."CustomerOrder"') IS NULL THEN
    CREATE TABLE "CustomerOrder" (
        "id" TEXT NOT NULL,
        "tenantId" TEXT NOT NULL,
        "storeId" TEXT NOT NULL,
        "storeCode" TEXT NOT NULL,
        "orderNo" TEXT NOT NULL,
        "customerTelegramId" TEXT,
        "customerLang" TEXT,
        "customerName" TEXT,
        "customerPhone" TEXT,
        "deliveryAddress" TEXT,
        "deliveryNote" TEXT,
        "deliveryLat" DOUBLE PRECISION,
        "deliveryLng" DOUBLE PRECISION,
        "deliveryAddressPhotoUrl" TEXT,
        "deliveryAddressPhotoData" TEXT,
        "itemsJson" TEXT NOT NULL,
        "totalAmount" DECIMAL(12,2) NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'PENDING',
        "remark" TEXT,
        "paymentStatus" VARCHAR(20) NOT NULL DEFAULT 'UNPAID',
        "paymentMethod" VARCHAR(20),
        "paidAt" TIMESTAMP(3),
        "paidAmount" DECIMAL(12,2),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "CustomerOrder_pkey" PRIMARY KEY ("id")
    );

    CREATE UNIQUE INDEX "CustomerOrder_orderNo_key" ON "CustomerOrder"("orderNo");

    CREATE INDEX "CustomerOrder_tenantId_createdAt_idx" ON "CustomerOrder"("tenantId", "createdAt");

    CREATE INDEX "CustomerOrder_storeId_createdAt_idx" ON "CustomerOrder"("storeId", "createdAt");

    CREATE INDEX "CustomerOrder_orderNo_idx" ON "CustomerOrder"("orderNo");
  END IF;
END;
$$;

COMMIT;
