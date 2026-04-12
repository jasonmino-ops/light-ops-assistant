-- CreateTable: MerchantPaymentConfig
CREATE TABLE "MerchantPaymentConfig" (
    "id"                 TEXT NOT NULL,
    "tenantId"           TEXT NOT NULL,
    "storeId"            TEXT,
    "provider"           TEXT NOT NULL DEFAULT 'BAKONG_KHQR',
    "merchantId"         TEXT NOT NULL,
    "merchantName"       TEXT NOT NULL,
    "merchantAccountRef" TEXT NOT NULL,
    "currency"           TEXT NOT NULL DEFAULT 'USD',
    "khqrEnabled"        BOOLEAN NOT NULL DEFAULT true,
    "isDefault"          BOOLEAN NOT NULL DEFAULT false,
    "isActive"           BOOLEAN NOT NULL DEFAULT true,
    "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"          TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantPaymentConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MerchantPaymentConfig_tenantId_idx" ON "MerchantPaymentConfig"("tenantId");

-- CreateIndex
CREATE INDEX "MerchantPaymentConfig_tenantId_storeId_idx" ON "MerchantPaymentConfig"("tenantId", "storeId");

-- AlterTable: PaymentIntent — add provider + merchantConfigId
ALTER TABLE "PaymentIntent"
    ADD COLUMN "provider"         TEXT,
    ADD COLUMN "merchantConfigId" TEXT;

-- CreateIndex
CREATE INDEX "PaymentIntent_merchantConfigId_idx" ON "PaymentIntent"("merchantConfigId");

-- AddForeignKey
ALTER TABLE "PaymentIntent"
    ADD CONSTRAINT "PaymentIntent_merchantConfigId_fkey"
    FOREIGN KEY ("merchantConfigId") REFERENCES "MerchantPaymentConfig"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
