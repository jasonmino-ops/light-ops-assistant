# Cashier-Offline-03C API 测试指南

## 目标

验证服务端离线订单同步 API：

```http
POST /api/cashier/offline-sync
```

该接口用于接收 `/cashier` Offline-02 保存在 IndexedDB 的离线 CASH 订单，服务端生成正式 SaleRecord，并写入 OfflineSaleSyncMap 做幂等与审计。

本阶段仅测试 API，不接 `/cashier` 前端同步按钮。

## 前置条件

- 生产数据库已执行 migration：`20260617010000_add_cashier_offline_sync_map`。
- `OfflineSaleSyncMap` 表存在。
- `SaleRecord` 离线来源字段存在。
- 测试门店已有 ACTIVE 商品。

Mino Pet Shop 示例：

- storeCode：`ST169E7000`
- storeId：`cmq6qboln000204l48c8bewd4`
- tenantId：`cmq6qbofj000104l4epsi4dqj`

## 构造测试 payload

示例只用于开发测试。每次正向测试请更换 `offlineOrderId`。

```json
{
  "storeId": "cmq6qboln000204l48c8bewd4",
  "storeCode": "ST169E7000",
  "deviceId": "offline03c-test-device",
  "orders": [
    {
      "offlineOrderId": "OFFLINE-ST169E7000-TEST-202606170001-1234",
      "tenantId": "cmq6qbofj000104l4epsi4dqj",
      "storeId": "cmq6qboln000204l48c8bewd4",
      "storeCode": "ST169E7000",
      "operatorUserId": null,
      "operatorName": "Cashier PWA",
      "deviceId": "offline03c-test-device",
      "createdAtLocal": "2026-06-17T00:00:00.000+07:00",
      "createdAtClientTimestamp": 1781629200000,
      "items": [
        {
          "productId": "真实 Product.id",
          "productName": "商品快照名",
          "barcode": "0001",
          "unitPrice": 5.5,
          "quantity": 1,
          "lineTotal": 5.5,
          "snapshotPrice": 5.5,
          "snapshotName": "商品快照名"
        }
      ],
      "subtotal": 5.5,
      "discountAmount": 0,
      "totalAmount": 5.5,
      "paymentMethod": "CASH",
      "paymentStatus": "PAID_OFFLINE",
      "syncStatus": "PENDING",
      "appVersion": "web",
      "cacheVersion": "cashier-offline-02"
    }
  ]
}
```

## 调用 API

本地开发：

```bash
curl -sS -X POST 'http://localhost:3000/api/cashier/offline-sync' \
  -H 'Content-Type: application/json' \
  -d @tmp/offline-sync-test.json | python3 -m json.tool
```

生产 smoke：

```bash
curl -sS -X POST 'https://light-ops-assistant.vercel.app/api/cashier/offline-sync' \
  -H 'Content-Type: application/json' \
  -d @tmp/offline-sync-test.json | python3 -m json.tool
```

## 期望成功结果

```json
{
  "total": 1,
  "successCount": 1,
  "duplicateCount": 0,
  "failedCount": 0,
  "results": [
    {
      "offlineOrderId": "OFFLINE-...",
      "status": "SYNCED",
      "serverSaleRecordId": "SaleRecord.id",
      "errorCode": null,
      "errorMessage": null
    }
  ]
}
```

## 验证 SaleRecord

```sql
SELECT id, "recordNo", "orderNo", source, "offlineOrderId", "offlineDeviceId",
       "offlineCreatedAtLocal", "offlineCreatedAtClientTimestamp",
       "offlineSyncedAt", "offlineSyncStatus", "inventoryException",
       "lineAmount", "createdAt"
FROM "SaleRecord"
WHERE "offlineOrderId" = 'OFFLINE-...'
ORDER BY "createdAt" DESC;
```

期望：

- `source = CASHIER_OFFLINE`
- `offlineSyncStatus = SYNCED`
- `offlineDeviceId` 与 payload 一致
- `lineAmount` 按数据库 Product.sellPrice 计算

## 验证 OfflineSaleSyncMap

```sql
SELECT "offlineOrderId", "deviceId", status, "saleRecordId", "syncedAt",
       "rawPayloadHash", "lastErrorCode", "lastErrorMessage"
FROM "OfflineSaleSyncMap"
WHERE "offlineOrderId" = 'OFFLINE-...';
```

期望：

- `status = SYNCED`
- `saleRecordId` 不为空
- `rawPayloadHash` 不为空

## 验证 DUPLICATE

重复提交相同 `storeId + deviceId + offlineOrderId`。

期望：

- 不重复创建 SaleRecord。
- 返回 `DUPLICATE`。
- 返回已有 `serverSaleRecordId`。

## 错误 payload 测试

### 非 CASH

将 `paymentMethod` 改为 `KHQR`。

期望：

- 返回 `FAILED`
- `errorCode = INVALID_PAYMENT_METHOD`

### 空 items

将 `items` 改为空数组。

期望：

- 返回 `FAILED`
- `errorCode = EMPTY_ITEMS`

### 金额不一致

将 `totalAmount` 改为错误金额。

期望：

- 返回 `FAILED`
- `errorCode = INVALID_AMOUNT`

### store 不匹配

将 `storeCode` 改为其他值。

期望：

- 返回 `FAILED`
- `errorCode = STORE_NOT_FOUND` 或 `STORE_MISMATCH`

## 确认前端未自动调用

Offline-03C 不接 `/cashier` 前端：

- 页面不会出现“同步离线订单”按钮。
- 恢复网络后不会自动上传 IndexedDB 离线订单。
- IndexedDB 本地订单状态不会被 API 自动改为 `SYNCED`。

客户端手动同步留到 Offline-03D。

## 当前边界

- 不改 `/cashier` 前端同步逻辑。
- 不改 `/records` 展示。
- 不改 dashboard 统计口径。
- 不改 KHQR / AI / 优惠券 / 会员 / 退款。
- 不新增数据库 migration。
