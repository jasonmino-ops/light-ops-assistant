-- EP-TXN-IDEMP-01: a dedicated, additive replay record for one cashier sale.
-- It deliberately does not store authentication material or payment secrets.
CREATE TABLE "CashierSaleIdempotency" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "payloadFingerprint" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROCESSING',
    "resultSnapshot" JSONB,
    "orderNo" TEXT,
    "paymentIntentId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashierSaleIdempotency_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CashierSaleIdempotency_operation_key"
  ON "CashierSaleIdempotency"("tenantId", "storeId", "actorType", "actorId", "operation", "idempotencyKey");
CREATE INDEX "CashierSaleIdempotency_tenant_store_expiresAt_idx"
  ON "CashierSaleIdempotency"("tenantId", "storeId", "expiresAt");
CREATE INDEX "CashierSaleIdempotency_orderNo_idx" ON "CashierSaleIdempotency"("orderNo");
CREATE INDEX "CashierSaleIdempotency_paymentIntentId_idx" ON "CashierSaleIdempotency"("paymentIntentId");

ALTER TABLE "CashierSaleIdempotency" ADD CONSTRAINT "CashierSaleIdempotency_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CashierSaleIdempotency" ADD CONSTRAINT "CashierSaleIdempotency_storeId_fkey"
  FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
