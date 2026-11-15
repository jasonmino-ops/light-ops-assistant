-- Supply missing historical manual DDL for a new database. Existing table
-- definitions, indexes and foreign keys are retained. Only absent columns are
-- added, with types/defaults matching the current application contract.
BEGIN;

ALTER TABLE "OpsAdmin"
  ADD COLUMN IF NOT EXISTS "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "lockedUntil" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "sessionVersion" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Product"
  ADD COLUMN IF NOT EXISTS "imageStorageKey" TEXT,
  ADD COLUMN IF NOT EXISTS "imageUpdatedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "imageUrl" TEXT;

ALTER TABLE "SaleRecord"
  ADD COLUMN IF NOT EXISTS "orderNo" TEXT;

ALTER TABLE "Store"
  ADD COLUMN IF NOT EXISTS "announcement" TEXT,
  ADD COLUMN IF NOT EXISTS "bannerData" TEXT,
  ADD COLUMN IF NOT EXISTS "bannerUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "businessType" TEXT NOT NULL DEFAULT 'GENERAL',
  ADD COLUMN IF NOT EXISTS "promoText" TEXT;

ALTER TABLE "Tenant"
  ADD COLUMN IF NOT EXISTS "tier" TEXT NOT NULL DEFAULT 'LITE';

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "staffNumber" INTEGER;

DO $$
BEGIN
  IF pg_catalog.to_regtype('public."CouponType"') IS NULL THEN
    CREATE TYPE "CouponType" AS ENUM ('AMOUNT_OFF', 'PERCENT_OFF');
  END IF;
END;
$$;

DO $$
BEGIN
  IF pg_catalog.to_regtype('public."CouponTemplateStatus"') IS NULL THEN
    CREATE TYPE "CouponTemplateStatus" AS ENUM ('ACTIVE', 'PAUSED', 'EXPIRED', 'DELETED');
  END IF;
END;
$$;

DO $$
BEGIN
  IF pg_catalog.to_regtype('public."CustomerCouponStatus"') IS NULL THEN
    CREATE TYPE "CustomerCouponStatus" AS ENUM ('AVAILABLE', 'USED', 'EXPIRED', 'CANCELLED');
  END IF;
END;
$$;

DO $$
BEGIN
  IF pg_catalog.to_regclass('public."BindToken"') IS NULL THEN
    CREATE TABLE "BindToken" (
        "id" TEXT NOT NULL,
        "token" TEXT NOT NULL,
        "tenantId" TEXT NOT NULL,
        "storeId" TEXT NOT NULL,
        "role" "UserRole" NOT NULL,
        "label" TEXT,
        "expiresAt" TIMESTAMP(3) NOT NULL,
        "maxUses" INTEGER NOT NULL DEFAULT 1,
        "usedCount" INTEGER NOT NULL DEFAULT 0,
        "status" TEXT NOT NULL DEFAULT 'ACTIVE',
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,

        CONSTRAINT "BindToken_pkey" PRIMARY KEY ("id")
    );

    CREATE UNIQUE INDEX "BindToken_token_key" ON "BindToken"("token");

    CREATE INDEX "BindToken_tenantId_idx" ON "BindToken"("tenantId");

    CREATE INDEX "BindToken_token_idx" ON "BindToken"("token");

    ALTER TABLE "BindToken" ADD CONSTRAINT "BindToken_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

    ALTER TABLE "BindToken" ADD CONSTRAINT "BindToken_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END;
$$;

DO $$
BEGIN
  IF pg_catalog.to_regclass('public."StoreCustomerContact"') IS NULL THEN
    CREATE TABLE "StoreCustomerContact" (
        "id" TEXT NOT NULL,
        "tenantId" TEXT,
        "storeCode" TEXT NOT NULL,
        "telegramId" TEXT NOT NULL,
        "telegramUsername" TEXT,
        "telegramFirstName" TEXT,
        "telegramLastName" TEXT,
        "telegramLanguageCode" TEXT,
        "lastOrderId" TEXT,
        "source" TEXT NOT NULL DEFAULT 'telegram_bind_after_order',
        "status" TEXT NOT NULL DEFAULT 'active',
        "opsNote" TEXT,
        "firstBoundAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "StoreCustomerContact_pkey" PRIMARY KEY ("id")
    );

    CREATE INDEX "StoreCustomerContact_tenantId_idx" ON "StoreCustomerContact"("tenantId");

    CREATE INDEX "StoreCustomerContact_storeCode_idx" ON "StoreCustomerContact"("storeCode");

    CREATE INDEX "StoreCustomerContact_telegramId_idx" ON "StoreCustomerContact"("telegramId");

    CREATE UNIQUE INDEX "StoreCustomerContact_storeCode_telegramId_key" ON "StoreCustomerContact"("storeCode", "telegramId");
  END IF;
END;
$$;

DO $$
BEGIN
  IF pg_catalog.to_regclass('public."CustomerTouchLog"') IS NULL THEN
    CREATE TABLE "CustomerTouchLog" (
        "id" TEXT NOT NULL,
        "tenantId" TEXT NOT NULL,
        "storeId" TEXT,
        "telegramId" TEXT NOT NULL,
        "templateKey" TEXT NOT NULL,
        "messageText" TEXT NOT NULL,
        "status" TEXT NOT NULL,
        "errorMessage" TEXT,
        "sentByUserId" TEXT NOT NULL,
        "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "CustomerTouchLog_pkey" PRIMARY KEY ("id")
    );

    CREATE INDEX "CustomerTouchLog_tenantId_telegramId_sentAt_idx" ON "CustomerTouchLog"("tenantId", "telegramId", "sentAt");

    CREATE INDEX "CustomerTouchLog_sentByUserId_idx" ON "CustomerTouchLog"("sentByUserId");
  END IF;
END;
$$;

DO $$
BEGIN
  IF pg_catalog.to_regclass('public."CouponTemplate"') IS NULL THEN
    CREATE TABLE "CouponTemplate" (
        "id" TEXT NOT NULL,
        "tenantId" TEXT NOT NULL,
        "storeId" TEXT,
        "name" TEXT NOT NULL,
        "type" "CouponType" NOT NULL DEFAULT 'AMOUNT_OFF',
        "amountOff" DECIMAL(10,2),
        "percentOff" INTEGER,
        "minSpend" DECIMAL(10,2) NOT NULL DEFAULT 0,
        "validDays" INTEGER NOT NULL DEFAULT 7,
        "status" "CouponTemplateStatus" NOT NULL DEFAULT 'ACTIVE',
        "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "CouponTemplate_pkey" PRIMARY KEY ("id")
    );

    CREATE INDEX "CouponTemplate_tenantId_status_idx" ON "CouponTemplate"("tenantId", "status");
  END IF;
END;
$$;

DO $$
BEGIN
  IF pg_catalog.to_regclass('public."CustomerCoupon"') IS NULL THEN
    CREATE TABLE "CustomerCoupon" (
        "id" TEXT NOT NULL,
        "tenantId" TEXT NOT NULL,
        "storeId" TEXT,
        "templateId" TEXT NOT NULL,
        "telegramId" TEXT NOT NULL,
        "status" "CustomerCouponStatus" NOT NULL DEFAULT 'AVAILABLE',
        "name" TEXT NOT NULL,
        "type" "CouponType" NOT NULL,
        "amountOff" DECIMAL(10,2),
        "percentOff" INTEGER,
        "minSpend" DECIMAL(10,2) NOT NULL DEFAULT 0,
        "expiresAt" TIMESTAMPTZ(6) NOT NULL,
        "usedAt" TIMESTAMPTZ(6),
        "usedOrderNo" TEXT,
        "batchId" TEXT,
        "issuedByUserId" TEXT,
        "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "CustomerCoupon_pkey" PRIMARY KEY ("id")
    );

    CREATE INDEX "CustomerCoupon_tenant_tg_status_idx" ON "CustomerCoupon"("tenantId", "telegramId", "status");

    CREATE INDEX "CustomerCoupon_tenant_store_tg_status_idx" ON "CustomerCoupon"("tenantId", "storeId", "telegramId", "status");

    CREATE INDEX "CustomerCoupon_batchId_idx" ON "CustomerCoupon"("batchId");

    ALTER TABLE "CustomerCoupon" ADD CONSTRAINT "CustomerCoupon_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "CouponTemplate"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
  END IF;
END;
$$;

DO $$
BEGIN
  IF pg_catalog.to_regclass('public."CouponRedemption"') IS NULL THEN
    CREATE TABLE "CouponRedemption" (
        "id" TEXT NOT NULL,
        "tenantId" TEXT NOT NULL,
        "storeId" TEXT NOT NULL,
        "couponId" TEXT NOT NULL,
        "telegramId" TEXT NOT NULL,
        "orderNo" TEXT NOT NULL,
        "discountAmount" DECIMAL(10,2) NOT NULL,
        "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "CouponRedemption_pkey" PRIMARY KEY ("id")
    );

    CREATE INDEX "CouponRedemption_tenant_store_createdAt_idx" ON "CouponRedemption"("tenantId", "storeId", "createdAt");

    CREATE INDEX "CouponRedemption_couponId_idx" ON "CouponRedemption"("couponId");

    CREATE UNIQUE INDEX "CouponRedemption_orderNo_key" ON "CouponRedemption"("orderNo");

    ALTER TABLE "CouponRedemption" ADD CONSTRAINT "CouponRedemption_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "CustomerCoupon"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
  END IF;
END;
$$;

DO $$
BEGIN
  IF pg_catalog.to_regclass('public."CouponIssueBatch"') IS NULL THEN
    CREATE TABLE "CouponIssueBatch" (
        "id" TEXT NOT NULL,
        "tenantId" TEXT NOT NULL,
        "storeId" TEXT,
        "templateId" TEXT NOT NULL,
        "issuedByUserId" TEXT NOT NULL,
        "totalCount" INTEGER NOT NULL DEFAULT 0,
        "successCount" INTEGER NOT NULL DEFAULT 0,
        "failedCount" INTEGER NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "CouponIssueBatch_pkey" PRIMARY KEY ("id")
    );

    CREATE INDEX "CouponIssueBatch_tenant_createdAt_idx" ON "CouponIssueBatch"("tenantId", "createdAt");

    ALTER TABLE "CouponIssueBatch" ADD CONSTRAINT "CouponIssueBatch_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "CouponTemplate"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
  END IF;
END;
$$;

DO $$
BEGIN
  IF pg_catalog.to_regclass('public."ConversationLog"') IS NULL THEN
    CREATE TABLE "ConversationLog" (
        "id" TEXT NOT NULL,
        "tenantId" TEXT,
        "storeCode" TEXT,
        "telegramId" TEXT NOT NULL,
        "lang" TEXT,
        "direction" TEXT NOT NULL,
        "text" TEXT NOT NULL,
        "intentLayer" INTEGER,
        "intentSlot" TEXT,
        "intentSource" TEXT,
        "escalated" BOOLEAN NOT NULL DEFAULT false,
        "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "ConversationLog_pkey" PRIMARY KEY ("id")
    );

    CREATE INDEX "ConversationLog_tg_createdAt_idx" ON "ConversationLog"("telegramId", "createdAt");

    CREATE INDEX "ConversationLog_tenant_createdAt_idx" ON "ConversationLog"("tenantId", "createdAt");
  END IF;
END;
$$;

COMMIT;
