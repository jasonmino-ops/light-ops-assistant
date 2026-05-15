# CustomerOrder 配送/上门字段 DDL（手动执行）

Supabase SQL Editor 跑（幂等可重复）。完成后回到本地 `npx prisma generate`。

## ALTER（6 个可空列）

```sql
ALTER TABLE "CustomerOrder"
  ADD COLUMN IF NOT EXISTS "customerName"    TEXT,
  ADD COLUMN IF NOT EXISTS "customerPhone"   TEXT,
  ADD COLUMN IF NOT EXISTS "deliveryAddress" TEXT,
  ADD COLUMN IF NOT EXISTS "deliveryNote"    TEXT,
  ADD COLUMN IF NOT EXISTS "deliveryLat"     DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "deliveryLng"     DOUBLE PRECISION;
```

## 回滚

```sql
ALTER TABLE "CustomerOrder"
  DROP COLUMN IF EXISTS "customerName",
  DROP COLUMN IF EXISTS "customerPhone",
  DROP COLUMN IF EXISTS "deliveryAddress",
  DROP COLUMN IF EXISTS "deliveryNote",
  DROP COLUMN IF EXISTS "deliveryLat",
  DROP COLUMN IF EXISTS "deliveryLng";
```

## 字段语义

- `customerPhone / deliveryAddress`：当顾客在 /menu 选第二个方式（送货/上门/外卖等）时由后端强制非空，否则 400。
- `deliveryLat / deliveryLng`：可选，顾客点「使用当前位置」获取；订单通知中拼 `https://maps.google.com/?q=lat,lng`。
- `deliveryNote`：门牌、楼层、备注；与订单顶层 `remark` 区分，专用于配送上下文。
