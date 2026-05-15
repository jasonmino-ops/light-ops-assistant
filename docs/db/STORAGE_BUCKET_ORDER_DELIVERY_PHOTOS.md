# Supabase Storage bucket: order-delivery-photos

顾客门牌/位置照片由 `/api/uploads/delivery-photo` 上传到此 public bucket，
返回公开 URL 写入 `CustomerOrder.deliveryAddressPhotoUrl`。

## 一次性创建（Supabase Dashboard → Storage → New bucket）

- Bucket name：`order-delivery-photos`
- Public：**Yes**（开启 public access；上传后通过 `/storage/v1/object/public/...` 直接访问）
- File size limit：5 MB
- Allowed MIME：`image/jpeg, image/png, image/webp`

或用 SQL（Supabase SQL Editor，service_role）：

```sql
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('order-delivery-photos', 'order-delivery-photos', TRUE,
        5242880,
        ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;
```

## 环境变量

确认 Vercel / 本地 .env 已配置：
- `SUPABASE_URL=https://<project-ref>.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY=<service role key>`（仅服务端读取，绝不暴露给前端）

## 文件路径策略

`{anonymous}/{yyyyMMdd}/{uuid}.{jpg|png|webp}`

- 顾客端上传未走鉴权 cookie，按 `anonymous/` 顶级目录隔离
- 日期分桶便于回收/审计
- 随机 ID 避免命名冲突 + 防猜

## 数据写入

- `CustomerOrder.deliveryAddressPhotoUrl` ← Storage public URL（形如 `${SUPABASE_URL}/storage/v1/object/public/order-delivery-photos/anonymous/20260516/xxx.jpg`）
- `CustomerOrder.deliveryAddressPhotoData` ← **新订单不写入**，仅保留旧数据以兼容历史
