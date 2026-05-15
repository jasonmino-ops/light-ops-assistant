# CustomerOrder.customerLang DDL（手动执行）

不走 prisma migrate。在 Supabase 后台 → SQL Editor 以 `service_role` 身份执行下方 SQL（安全可重复运行）。

执行后回到本地跑 `npx prisma generate` 让 Prisma Client 包含新字段即可。

## ALTER（幂等）

```sql
ALTER TABLE "CustomerOrder"
  ADD COLUMN IF NOT EXISTS "customerLang" TEXT;
```

## 回滚（如需）

```sql
ALTER TABLE "CustomerOrder"
  DROP COLUMN IF EXISTS "customerLang";
```

## 字段语义

- 顾客在 `/menu` 下单时把当前 H5 语言（`zh | en | km`）传给 `POST /api/public/orders`，后端写入此列。
- 商户后台修改订单状态（PENDING → CONFIRMED/CANCELLED → COMPLETED/CANCELLED）触发给顾客的 Telegram 通知时，按此列渲染 zh/en/km 模板。
- 字段允许为空。空时通知端按以下顺序 fallback：
  1. `StoreCustomerContact.telegramLanguageCode`（normalize 为 zh/en/km）
  2. `zh`
