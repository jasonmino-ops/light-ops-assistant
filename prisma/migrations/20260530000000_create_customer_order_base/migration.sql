-- Repair historical migration chain drift.
-- CustomerOrder was added to prisma/schema.prisma before this point in history,
-- but no CREATE TABLE migration was committed. The following campaign migration
-- alters CustomerOrder, so empty database replay needs the base table here.

CREATE TABLE IF NOT EXISTS "CustomerOrder" (
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
    "paymentStatus" TEXT NOT NULL DEFAULT 'UNPAID',
    "paymentMethod" TEXT,
    "paidAt" TIMESTAMP(3),
    "paidAmount" DECIMAL(12,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerOrder_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "CustomerOrder"
  ADD COLUMN IF NOT EXISTS "customerLang" TEXT,
  ADD COLUMN IF NOT EXISTS "customerName" TEXT,
  ADD COLUMN IF NOT EXISTS "customerPhone" TEXT,
  ADD COLUMN IF NOT EXISTS "deliveryAddress" TEXT,
  ADD COLUMN IF NOT EXISTS "deliveryNote" TEXT,
  ADD COLUMN IF NOT EXISTS "deliveryLat" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "deliveryLng" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "deliveryAddressPhotoUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "deliveryAddressPhotoData" TEXT,
  ADD COLUMN IF NOT EXISTS "paymentStatus" TEXT NOT NULL DEFAULT 'UNPAID',
  ADD COLUMN IF NOT EXISTS "paymentMethod" TEXT,
  ADD COLUMN IF NOT EXISTS "paidAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "paidAmount" DECIMAL(12,2);

CREATE UNIQUE INDEX IF NOT EXISTS "CustomerOrder_orderNo_key" ON "CustomerOrder"("orderNo");
CREATE INDEX IF NOT EXISTS "CustomerOrder_tenantId_createdAt_idx" ON "CustomerOrder"("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "CustomerOrder_storeId_createdAt_idx" ON "CustomerOrder"("storeId", "createdAt");
CREATE INDEX IF NOT EXISTS "CustomerOrder_orderNo_idx" ON "CustomerOrder"("orderNo");
