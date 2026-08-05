-- EP-BR-LINK-AUTH-01-R2: short-lived encrypted result for one idempotent
-- Browser POS binding operation. This is intentionally separate from
-- OperationLog so credentials are never retained in ordinary audit payloads.
CREATE TABLE "BrowserPosBindingDelivery" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "browserDeviceId" TEXT NOT NULL,
    "bindingAttemptId" TEXT NOT NULL,
    "browserPosDeviceId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'READY',
    "encryptedResult" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrowserPosBindingDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BrowserPosBindingDelivery_requestId_key" ON "BrowserPosBindingDelivery"("requestId");
CREATE UNIQUE INDEX "BrowserPosBindingDelivery_request_device_attempt_key"
  ON "BrowserPosBindingDelivery"("requestId", "browserDeviceId", "bindingAttemptId");
CREATE INDEX "BrowserPosBindingDelivery_tenantId_storeId_idx" ON "BrowserPosBindingDelivery"("tenantId", "storeId");
CREATE INDEX "BrowserPosBindingDelivery_expiresAt_idx" ON "BrowserPosBindingDelivery"("expiresAt");

ALTER TABLE "BrowserPosBindingDelivery" ADD CONSTRAINT "BrowserPosBindingDelivery_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BrowserPosBindingDelivery" ADD CONSTRAINT "BrowserPosBindingDelivery_storeId_fkey"
  FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BrowserPosBindingDelivery" ADD CONSTRAINT "BrowserPosBindingDelivery_browserPosDeviceId_fkey"
  FOREIGN KEY ("browserPosDeviceId") REFERENCES "BrowserPosDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
