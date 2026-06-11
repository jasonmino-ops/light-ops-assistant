CREATE TABLE IF NOT EXISTS "AiSupportProviderConfig" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "storeId" TEXT,
  "provider" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "apiBaseUrl" TEXT,
  "clientId" TEXT,
  "encryptedApiSecret" TEXT,
  "secretRef" TEXT,
  "allowedToolsJson" TEXT NOT NULL DEFAULT '[]',
  "timeoutMs" INTEGER NOT NULL DEFAULT 3000,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiSupportProviderConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AiSupportAuditLog" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT,
  "storeId" TEXT,
  "customerId" TEXT,
  "sessionId" TEXT,
  "provider" TEXT NOT NULL,
  "userMessage" TEXT NOT NULL,
  "aiReply" TEXT,
  "intent" TEXT,
  "confidence" DOUBLE PRECISION,
  "needHuman" BOOLEAN,
  "toolCallsJson" TEXT,
  "providerAuditId" TEXT,
  "latencyMs" INTEGER,
  "status" TEXT NOT NULL,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiSupportAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AiSupportProviderConfig_tenantId_idx" ON "AiSupportProviderConfig"("tenantId");
CREATE INDEX IF NOT EXISTS "AiSupportProviderConfig_tenantId_storeId_idx" ON "AiSupportProviderConfig"("tenantId", "storeId");
CREATE INDEX IF NOT EXISTS "AiSupportProviderConfig_provider_idx" ON "AiSupportProviderConfig"("provider");
CREATE UNIQUE INDEX IF NOT EXISTS "AiSupportProviderConfig_tenantId_storeId_provider_key" ON "AiSupportProviderConfig"("tenantId", "storeId", "provider");

CREATE INDEX IF NOT EXISTS "AiSupportAuditLog_tenantId_createdAt_idx" ON "AiSupportAuditLog"("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "AiSupportAuditLog_storeId_createdAt_idx" ON "AiSupportAuditLog"("storeId", "createdAt");
CREATE INDEX IF NOT EXISTS "AiSupportAuditLog_customerId_createdAt_idx" ON "AiSupportAuditLog"("customerId", "createdAt");
CREATE INDEX IF NOT EXISTS "AiSupportAuditLog_sessionId_createdAt_idx" ON "AiSupportAuditLog"("sessionId", "createdAt");
CREATE INDEX IF NOT EXISTS "AiSupportAuditLog_provider_createdAt_idx" ON "AiSupportAuditLog"("provider", "createdAt");
CREATE INDEX IF NOT EXISTS "AiSupportAuditLog_status_createdAt_idx" ON "AiSupportAuditLog"("status", "createdAt");
