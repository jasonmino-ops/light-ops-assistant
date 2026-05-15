# CustomerOrder 门牌/位置照片 DDL（手动执行）

Supabase SQL Editor 跑（幂等可重复）。完成后回到本地 `npx prisma generate`。

## ALTER（2 个可空列）

```sql
ALTER TABLE "CustomerOrder"
  ADD COLUMN IF NOT EXISTS "deliveryAddressPhotoUrl"  TEXT,
  ADD COLUMN IF NOT EXISTS "deliveryAddressPhotoData" TEXT;
```

## 回滚

```sql
ALTER TABLE "CustomerOrder"
  DROP COLUMN IF EXISTS "deliveryAddressPhotoUrl",
  DROP COLUMN IF EXISTS "deliveryAddressPhotoData";
```

## 字段语义

- `deliveryAddressPhotoData`：图片 base64 data URL（`data:image/jpeg;base64,...`），由
  顾客在 /menu 上传时压缩后写入。**仅供内部 GET 端点读取返回二进制。**
- `deliveryAddressPhotoUrl`：商户/配送员可点击的可寻址 URL。建议形如
  `${NEXT_PUBLIC_APP_URL}/api/orders/<orderNo>/delivery-photo`，
  访问时由该端点从 `deliveryAddressPhotoData` 抽出二进制返回。

> 说明：本期未接 Supabase Storage，先用 base64 落库 + 内部端点访问。
> 如未来切换到 Storage（建议 bucket `order-delivery-photos`），把
> `deliveryAddressPhotoUrl` 直接写为 Storage public URL，`deliveryAddressPhotoData` 留空即可。
