CREATE TABLE IF NOT EXISTS "PosSession" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "storeCode" TEXT NOT NULL,
  "operatorUserId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "paymentMethod" TEXT,
  "paymentStatus" TEXT,
  "itemsJson" TEXT NOT NULL DEFAULT '[]',
  "totalAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "itemCount" INTEGER NOT NULL DEFAULT 0,
  "khqrPayload" TEXT,
  "khqrImageUrl" TEXT,
  "orderNo" TEXT,
  "message" TEXT,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PosSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PosSession_tenantId_storeId_key"
  ON "PosSession"("tenantId", "storeId");
CREATE INDEX IF NOT EXISTS "PosSession_storeCode_idx"
  ON "PosSession"("storeCode");
CREATE INDEX IF NOT EXISTS "PosSession_updatedAt_idx"
  ON "PosSession"("updatedAt");
