-- Payment-Shinhan-01A: generic provider transaction log for Shinhan Deeplink test framework.

CREATE TABLE "PaymentTransaction" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "customerOrderId" TEXT,
  "salesRecordId" TEXT,
  "provider" TEXT NOT NULL,
  "method" TEXT NOT NULL,
  "trxId" TEXT NOT NULL,
  "providerTrxCode" TEXT,
  "amount" DECIMAL(12,2) NOT NULL,
  "currency" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "deepLinkUrl" TEXT,
  "callbackUrl" TEXT,
  "requestPayload" JSONB,
  "responsePayload" JSONB,
  "callbackPayload" JSONB,
  "inquiryPayload" JSONB,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "signatureVerified" BOOLEAN NOT NULL DEFAULT false,
  "paidAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PaymentTransaction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PaymentTransaction_trxId_key" ON "PaymentTransaction"("trxId");
CREATE INDEX "PaymentTransaction_tenantId_createdAt_idx" ON "PaymentTransaction"("tenantId", "createdAt");
CREATE INDEX "PaymentTransaction_storeId_createdAt_idx" ON "PaymentTransaction"("storeId", "createdAt");
CREATE INDEX "PaymentTransaction_customerOrderId_idx" ON "PaymentTransaction"("customerOrderId");
CREATE INDEX "PaymentTransaction_salesRecordId_idx" ON "PaymentTransaction"("salesRecordId");
CREATE INDEX "PaymentTransaction_status_idx" ON "PaymentTransaction"("status");
