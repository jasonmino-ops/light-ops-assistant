# Store.businessType DDL（手动执行）

Supabase SQL Editor 跑（幂等可重复执行）。完成后回到本地 `npx prisma generate`。

## ALTER

```sql
ALTER TABLE "Store"
  ADD COLUMN IF NOT EXISTS "businessType" TEXT NOT NULL DEFAULT 'GENERAL';
```

> `NOT NULL DEFAULT 'GENERAL'`：旧行回填为 `GENERAL`，新建门店默认 `GENERAL`。

## 回滚

```sql
ALTER TABLE "Store" DROP COLUMN IF EXISTS "businessType";
```

## 取值范围

`FOOD | RETAIL | SERVICE | GENERAL`。本期后端校验在 `/api/store/settings`。
