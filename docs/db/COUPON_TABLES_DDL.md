# 优惠券最小闭环 DDL（手动执行）

不走 prisma migrate。在 Supabase 后台 → SQL Editor 以 `service_role` 身份运行下方 SQL。

完成后回 prisma generate，让 Prisma Client 包含新类型即可。

## 一次性建表 SQL

```sql
-- =========================================================
-- Coupon v1 — AMOUNT_OFF 满减券为主，PERCENT_OFF 预留字段
-- =========================================================

CREATE TABLE IF NOT EXISTS "CouponTemplate" (
  "id"          TEXT PRIMARY KEY,
  "tenantId"    TEXT NOT NULL,
  "storeId"     TEXT,
  "name"        TEXT NOT NULL,
  "type"        TEXT NOT NULL DEFAULT 'AMOUNT_OFF',  -- AMOUNT_OFF | PERCENT_OFF
  "amountOff"   DECIMAL(10,2),
  "percentOff"  INTEGER,
  "minSpend"    DECIMAL(10,2) NOT NULL DEFAULT 0,
  "validDays"   INTEGER       NOT NULL DEFAULT 7,
  "status"      TEXT          NOT NULL DEFAULT 'ACTIVE',
  "createdAt"   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  "updatedAt"   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "CouponTemplate_tenantId_status_idx"
  ON "CouponTemplate" ("tenantId", "status");

CREATE TABLE IF NOT EXISTS "CustomerCoupon" (
  "id"             TEXT PRIMARY KEY,
  "tenantId"       TEXT NOT NULL,
  "storeId"        TEXT,
  "templateId"     TEXT NOT NULL REFERENCES "CouponTemplate"("id"),
  "telegramId"     TEXT NOT NULL,
  "status"         TEXT NOT NULL DEFAULT 'AVAILABLE',  -- AVAILABLE|USED|EXPIRED|CANCELLED
  "name"           TEXT NOT NULL,
  "type"           TEXT NOT NULL,
  "amountOff"      DECIMAL(10,2),
  "percentOff"     INTEGER,
  "minSpend"       DECIMAL(10,2) NOT NULL DEFAULT 0,
  "expiresAt"      TIMESTAMPTZ   NOT NULL,
  "usedAt"         TIMESTAMPTZ,
  "usedOrderNo"    TEXT,
  "batchId"        TEXT,
  "issuedByUserId" TEXT,
  "createdAt"      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  "updatedAt"      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "CustomerCoupon_tenant_tg_status_idx"
  ON "CustomerCoupon" ("tenantId", "telegramId", "status");
CREATE INDEX IF NOT EXISTS "CustomerCoupon_tenant_store_tg_status_idx"
  ON "CustomerCoupon" ("tenantId", "storeId", "telegramId", "status");
CREATE INDEX IF NOT EXISTS "CustomerCoupon_batchId_idx"
  ON "CustomerCoupon" ("batchId");

CREATE TABLE IF NOT EXISTS "CouponRedemption" (
  "id"             TEXT PRIMARY KEY,
  "tenantId"       TEXT NOT NULL,
  "storeId"        TEXT NOT NULL,
  "couponId"       TEXT NOT NULL REFERENCES "CustomerCoupon"("id"),
  "telegramId"     TEXT NOT NULL,
  "orderNo"        TEXT NOT NULL UNIQUE,
  "discountAmount" DECIMAL(10,2) NOT NULL,
  "createdAt"      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "CouponRedemption_tenant_store_createdAt_idx"
  ON "CouponRedemption" ("tenantId", "storeId", "createdAt");
CREATE INDEX IF NOT EXISTS "CouponRedemption_couponId_idx"
  ON "CouponRedemption" ("couponId");

CREATE TABLE IF NOT EXISTS "CouponIssueBatch" (
  "id"             TEXT PRIMARY KEY,
  "tenantId"       TEXT NOT NULL,
  "storeId"        TEXT,
  "templateId"     TEXT NOT NULL REFERENCES "CouponTemplate"("id"),
  "issuedByUserId" TEXT NOT NULL,
  "totalCount"     INTEGER NOT NULL DEFAULT 0,
  "successCount"   INTEGER NOT NULL DEFAULT 0,
  "failedCount"    INTEGER NOT NULL DEFAULT 0,
  "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "CouponIssueBatch_tenant_createdAt_idx"
  ON "CouponIssueBatch" ("tenantId", "createdAt");
```

## 回滚

```sql
DROP TABLE IF EXISTS "CouponRedemption";
DROP TABLE IF EXISTS "CouponIssueBatch";
DROP TABLE IF EXISTS "CustomerCoupon";
DROP TABLE IF EXISTS "CouponTemplate";
```
