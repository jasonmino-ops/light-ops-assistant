-- EP-CC-01 Computer Client Binding (Windows Agent V0.4 <-> E-Shop Cloud).
--
-- Fully isolated from the legacy Desktop PIN activation chain and from the
-- Browser POS device token: separate tables, separate secret
-- (COMPUTER_CLIENT_TOKEN_SECRET), separate credential prefixes.
--
-- Credential plaintext (claimSecret / deviceSecret) is generated and stored by
-- the Agent on the local machine. The cloud only ever persists HMAC hashes.
-- No plaintext credential is written to the database or to logs.

CREATE TYPE "ComputerBindingStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED');
CREATE TYPE "ComputerCredentialStatus" AS ENUM ('PENDING', 'ACTIVE', 'VOID');

CREATE TABLE "ComputerBinding" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "installationIdHash" TEXT NOT NULL,
    "computerName" TEXT NOT NULL,
    "agentVersion" TEXT,
    "deviceInfo" JSONB,
    "status" "ComputerBindingStatus" NOT NULL DEFAULT 'PENDING',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "claimSecretHash" TEXT NOT NULL,
    "claimSecretVersion" INTEGER NOT NULL DEFAULT 1,
    "deviceSecretHash" TEXT NOT NULL,
    "deviceSecretVersion" INTEGER NOT NULL DEFAULT 1,
    "credentialStatus" "ComputerCredentialStatus" NOT NULL DEFAULT 'PENDING',
    "credentialActivatedAt" TIMESTAMP(3),
    "credentialExpiresAt" TIMESTAMP(3),
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "boundAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComputerBinding_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ComputerBindingAudit" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "bindingId" TEXT,
    "actorUserId" TEXT,
    "eventType" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "reasonCode" TEXT,
    "ipHash" TEXT,
    "userAgentHash" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComputerBindingAudit_pkey" PRIMARY KEY ("id")
);

-- Store(id, tenantId) 复合唯一：作为 ComputerBinding 复合外键的引用目标。
-- 纯附加索引，不改动 Store 既有列与既有约束。
CREATE UNIQUE INDEX "Store_id_tenantId_key" ON "Store"("id", "tenantId");

CREATE UNIQUE INDEX "ComputerBinding_installationIdHash_key" ON "ComputerBinding"("installationIdHash");
CREATE INDEX "ComputerBinding_tenantId_storeId_status_idx" ON "ComputerBinding"("tenantId", "storeId", "status");
CREATE INDEX "ComputerBinding_storeId_status_requestedAt_idx" ON "ComputerBinding"("storeId", "status", "requestedAt");
CREATE INDEX "ComputerBinding_status_expiresAt_idx" ON "ComputerBinding"("status", "expiresAt");
CREATE INDEX "ComputerBinding_decidedByUserId_idx" ON "ComputerBinding"("decidedByUserId");

CREATE INDEX "ComputerBindingAudit_tenantId_createdAt_idx" ON "ComputerBindingAudit"("tenantId", "createdAt");
CREATE INDEX "ComputerBindingAudit_storeId_createdAt_idx" ON "ComputerBindingAudit"("storeId", "createdAt");
CREATE INDEX "ComputerBindingAudit_bindingId_createdAt_idx" ON "ComputerBindingAudit"("bindingId", "createdAt");
CREATE INDEX "ComputerBindingAudit_eventType_createdAt_idx" ON "ComputerBindingAudit"("eventType", "createdAt");
CREATE INDEX "ComputerBindingAudit_result_createdAt_idx" ON "ComputerBindingAudit"("result", "createdAt");

ALTER TABLE "ComputerBinding" ADD CONSTRAINT "ComputerBinding_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- 复合外键：数据库层面保证 storeId 必须属于 tenantId，
-- 绑定记录不可能出现「门店不属于该租户」的非法组合。
ALTER TABLE "ComputerBinding" ADD CONSTRAINT "ComputerBinding_storeId_tenantId_fkey" FOREIGN KEY ("storeId", "tenantId") REFERENCES "Store"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ComputerBinding" ADD CONSTRAINT "ComputerBinding_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ComputerBindingAudit" ADD CONSTRAINT "ComputerBindingAudit_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ComputerBindingAudit" ADD CONSTRAINT "ComputerBindingAudit_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ComputerBindingAudit" ADD CONSTRAINT "ComputerBindingAudit_bindingId_fkey" FOREIGN KEY ("bindingId") REFERENCES "ComputerBinding"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ComputerBindingAudit" ADD CONSTRAINT "ComputerBindingAudit_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
