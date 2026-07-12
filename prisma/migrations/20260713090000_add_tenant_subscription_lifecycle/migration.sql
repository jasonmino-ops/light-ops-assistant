-- Merchant Subscription Lifecycle V1 Milestone A
-- Sidecar subscription snapshot and event ledger. No business flow checks.

CREATE TABLE "TenantSubscription" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "trialStartedAt" TIMESTAMP(3),
    "trialEndsAt" TIMESTAMP(3),
    "currentPeriodStartedAt" TIMESTAMP(3),
    "currentPeriodEndsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantSubscription_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SubscriptionEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "previousStatus" TEXT,
    "nextStatus" TEXT,
    "previousPeriodEndsAt" TIMESTAMP(3),
    "nextPeriodEndsAt" TIMESTAMP(3),
    "monthsAdded" INTEGER,
    "amount" DECIMAL(65,30),
    "currency" TEXT,
    "paymentReference" TEXT,
    "note" TEXT,
    "operatorId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TenantSubscription_tenantId_key" ON "TenantSubscription"("tenantId");
CREATE UNIQUE INDEX "SubscriptionEvent_idempotencyKey_key" ON "SubscriptionEvent"("idempotencyKey");
CREATE INDEX "SubscriptionEvent_tenantId_createdAt_idx" ON "SubscriptionEvent"("tenantId", "createdAt");
CREATE INDEX "SubscriptionEvent_subscriptionId_createdAt_idx" ON "SubscriptionEvent"("subscriptionId", "createdAt");

ALTER TABLE "TenantSubscription" ADD CONSTRAINT "TenantSubscription_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SubscriptionEvent" ADD CONSTRAINT "SubscriptionEvent_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SubscriptionEvent" ADD CONSTRAINT "SubscriptionEvent_subscriptionId_fkey"
  FOREIGN KEY ("subscriptionId") REFERENCES "TenantSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Historical tenants are migrated as ACTIVE without an inferred expiry. Idempotent by tenantId.
WITH inserted_subscriptions AS (
  INSERT INTO "TenantSubscription" (
    "id",
    "tenantId",
    "status",
    "createdAt",
    "updatedAt"
  )
  SELECT
    'sub_' || md5(t."id" || ':subscription:v1'),
    t."id",
    'ACTIVE',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  FROM "Tenant" t
  WHERE NOT EXISTS (
    SELECT 1 FROM "TenantSubscription" s WHERE s."tenantId" = t."id"
  )
  RETURNING "id", "tenantId", "status"
)
INSERT INTO "SubscriptionEvent" (
  "id",
  "tenantId",
  "subscriptionId",
  "eventType",
  "nextStatus",
  "operatorId",
  "idempotencyKey",
  "createdAt"
)
SELECT
  'se_' || md5(s."tenantId" || ':subscription:migrated:v1'),
  s."tenantId",
  s."id",
  'MIGRATED',
  s."status",
  'migration:20260713090000',
  'migration:20260713090000:' || s."tenantId",
  CURRENT_TIMESTAMP
FROM inserted_subscriptions s
ON CONFLICT ("idempotencyKey") DO NOTHING;
