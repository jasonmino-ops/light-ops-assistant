-- Formalize historical manual DDL / db-push drift so a clean database can be
-- built by prisma migrate deploy alone.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CouponType') THEN
    CREATE TYPE "CouponType" AS ENUM ('AMOUNT_OFF', 'PERCENT_OFF');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CouponTemplateStatus') THEN
    CREATE TYPE "CouponTemplateStatus" AS ENUM ('ACTIVE', 'PAUSED', 'EXPIRED', 'DELETED');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CustomerCouponStatus') THEN
    CREATE TYPE "CustomerCouponStatus" AS ENUM ('AVAILABLE', 'USED', 'EXPIRED', 'CANCELLED');
  END IF;
END $$;

ALTER TABLE "Creator" ALTER COLUMN "updatedAt" DROP DEFAULT;

ALTER TABLE "ProductCategory" ALTER COLUMN "updatedAt" DROP DEFAULT;

ALTER TABLE "ProductImportSession" ALTER COLUMN "updatedAt" DROP DEFAULT;

ALTER TABLE "OpsAdmin"
  ADD COLUMN IF NOT EXISTS "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "lockedUntil" TIMESTAMP(3),
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

CREATE TABLE IF NOT EXISTS "BindToken" (
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

CREATE TABLE IF NOT EXISTS "StoreCustomerContact" (
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
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreCustomerContact_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "StoreCustomerContact"
  ADD COLUMN IF NOT EXISTS "opsNote" TEXT;

CREATE TABLE IF NOT EXISTS "CustomerTouchLog" (
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

CREATE TABLE IF NOT EXISTS "CouponTemplate" (
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CouponTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CustomerCoupon" (
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
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "usedOrderNo" TEXT,
    "batchId" TEXT,
    "issuedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerCoupon_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CouponRedemption" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "couponId" TEXT NOT NULL,
    "telegramId" TEXT NOT NULL,
    "orderNo" TEXT NOT NULL,
    "discountAmount" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CouponRedemption_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CouponIssueBatch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT,
    "templateId" TEXT NOT NULL,
    "issuedByUserId" TEXT NOT NULL,
    "totalCount" INTEGER NOT NULL DEFAULT 0,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CouponIssueBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ConversationLog" (
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BindToken_token_key" ON "BindToken"("token");
CREATE INDEX IF NOT EXISTS "BindToken_tenantId_idx" ON "BindToken"("tenantId");
CREATE INDEX IF NOT EXISTS "BindToken_token_idx" ON "BindToken"("token");

CREATE INDEX IF NOT EXISTS "StoreCustomerContact_tenantId_idx" ON "StoreCustomerContact"("tenantId");
CREATE INDEX IF NOT EXISTS "StoreCustomerContact_storeCode_idx" ON "StoreCustomerContact"("storeCode");
CREATE INDEX IF NOT EXISTS "StoreCustomerContact_telegramId_idx" ON "StoreCustomerContact"("telegramId");
CREATE UNIQUE INDEX IF NOT EXISTS "StoreCustomerContact_storeCode_telegramId_key"
  ON "StoreCustomerContact"("storeCode", "telegramId");

CREATE INDEX IF NOT EXISTS "CustomerTouchLog_tenantId_telegramId_sentAt_idx"
  ON "CustomerTouchLog"("tenantId", "telegramId", "sentAt");
CREATE INDEX IF NOT EXISTS "CustomerTouchLog_sentByUserId_idx"
  ON "CustomerTouchLog"("sentByUserId");

CREATE INDEX IF NOT EXISTS "CouponTemplate_tenantId_status_idx"
  ON "CouponTemplate"("tenantId", "status");

CREATE INDEX IF NOT EXISTS "CustomerCoupon_tenantId_telegramId_status_idx"
  ON "CustomerCoupon"("tenantId", "telegramId", "status");
CREATE INDEX IF NOT EXISTS "CustomerCoupon_tenantId_storeId_telegramId_status_idx"
  ON "CustomerCoupon"("tenantId", "storeId", "telegramId", "status");
CREATE INDEX IF NOT EXISTS "CustomerCoupon_batchId_idx" ON "CustomerCoupon"("batchId");

CREATE INDEX IF NOT EXISTS "CouponRedemption_tenantId_storeId_createdAt_idx"
  ON "CouponRedemption"("tenantId", "storeId", "createdAt");
CREATE INDEX IF NOT EXISTS "CouponRedemption_couponId_idx" ON "CouponRedemption"("couponId");
CREATE UNIQUE INDEX IF NOT EXISTS "CouponRedemption_orderNo_key" ON "CouponRedemption"("orderNo");

CREATE INDEX IF NOT EXISTS "CouponIssueBatch_tenantId_createdAt_idx"
  ON "CouponIssueBatch"("tenantId", "createdAt");

CREATE INDEX IF NOT EXISTS "ConversationLog_telegramId_createdAt_idx"
  ON "ConversationLog"("telegramId", "createdAt");
CREATE INDEX IF NOT EXISTS "ConversationLog_tenantId_createdAt_idx"
  ON "ConversationLog"("tenantId", "createdAt");

DROP INDEX IF EXISTS "CustomerCoupon_tenant_tg_status_idx";
DROP INDEX IF EXISTS "CustomerCoupon_tenant_store_tg_status_idx";
DROP INDEX IF EXISTS "CouponRedemption_tenant_store_createdAt_idx";
DROP INDEX IF EXISTS "CouponIssueBatch_tenant_createdAt_idx";
DROP INDEX IF EXISTS "ConversationLog_tg_createdAt_idx";
DROP INDEX IF EXISTS "ConversationLog_tenant_createdAt_idx";

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'BindToken_tenantId_fkey'
  ) THEN
    ALTER TABLE "BindToken"
      ADD CONSTRAINT "BindToken_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'BindToken_storeId_fkey'
  ) THEN
    ALTER TABLE "BindToken"
      ADD CONSTRAINT "BindToken_storeId_fkey"
      FOREIGN KEY ("storeId") REFERENCES "Store"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CustomerCoupon_templateId_fkey'
  ) THEN
    ALTER TABLE "CustomerCoupon"
      ADD CONSTRAINT "CustomerCoupon_templateId_fkey"
      FOREIGN KEY ("templateId") REFERENCES "CouponTemplate"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CouponRedemption_couponId_fkey'
  ) THEN
    ALTER TABLE "CouponRedemption"
      ADD CONSTRAINT "CouponRedemption_couponId_fkey"
      FOREIGN KEY ("couponId") REFERENCES "CustomerCoupon"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CouponIssueBatch_templateId_fkey'
  ) THEN
    ALTER TABLE "CouponIssueBatch"
      ADD CONSTRAINT "CouponIssueBatch_templateId_fkey"
      FOREIGN KEY ("templateId") REFERENCES "CouponTemplate"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "DesktopActivationPin"
  DROP CONSTRAINT IF EXISTS "DesktopActivationPin_createdByUserId_fkey";

ALTER TABLE "DesktopActivationPin"
  ADD CONSTRAINT "DesktopActivationPin_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
