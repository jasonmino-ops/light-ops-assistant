# Cashier Offline-03D 客户端手动同步测试指南

## 目标

验证 `/cashier` 可以把 Offline-02 保存在 IndexedDB 的离线 CASH 订单，手动上传到 Offline-03C 的服务端同步接口：

`POST /api/cashier/offline-sync`

本阶段只做手动同步，不做自动同步，不删除已同步本地订单，不实现 `/records` “离线补同步”标签。

## 前置条件

- Production 已部署 Offline-03D。
- 生产数据库已执行 Offline-03B migration。
- `OfflineSaleSyncMap` 表存在。
- `SaleRecord` 离线来源字段存在。
- 使用门店链接打开：

```text
/cashier?storeCode=ST169E7000
```

## 测试 1：联网缓存商品

1. 联网打开 `/cashier?storeCode=ST169E7000`。
2. 确认页面显示在线。
3. 确认商品加载正常。
4. 确认状态区显示商品缓存数量和缓存时间。
5. 在 DevTools → Application → IndexedDB 中确认：
   - `light_ops_cashier_offline`
   - `cashier_products`
   - `cashier_meta`

## 测试 2：断网创建离线 CASH 订单

1. 断开网络，或在 DevTools 中模拟 Offline。
2. 页面应显示离线收银模式。
3. 从缓存商品中选择商品并加入购物车。
4. 确认 KHQR 被禁用。
5. 使用 CASH 完成收款。
6. 页面提示离线订单已保存。
7. 待同步离线订单数量增加。
8. IndexedDB 中确认：
   - `cashier_offline_orders`
   - 新订单 `syncStatus=PENDING`
   - `paymentMethod=CASH`
   - `paymentStatus=PAID_OFFLINE`

## 测试 3：恢复网络后不自动同步

1. 恢复网络。
2. 页面应显示在线。
3. 页面提示有离线订单待同步。
4. 不点击按钮时，不应自动调用 `/api/cashier/offline-sync`。
5. IndexedDB 订单仍保持 `PENDING`。

## 测试 4：手动同步离线订单

1. 点击“同步离线订单”。
2. 按钮进入“同步中…”状态。
3. 同步完成后页面显示汇总：
   - 成功 X 笔
   - 重复 X 笔
   - 失败 X 笔
4. IndexedDB 中确认订单更新为：
   - `syncStatus=SYNCED`
   - `serverSaleRecordId` 有值
   - `syncedAt` 有值
   - `lastSyncError=null`
5. 待同步离线订单数量减少。

## 测试 5：验证服务端记录

同步成功后，在数据库中确认：

- `OfflineSaleSyncMap` 有对应记录。
- `OfflineSaleSyncMap.status=SYNCED`。
- `OfflineSaleSyncMap.saleRecordId` 有值。
- `SaleRecord.source=CASHIER_OFFLINE`。
- `SaleRecord.offlineOrderId` 与本地订单一致。
- `PaymentIntent.paymentMethod=CASH` 且状态为 PAID。

## 测试 6：重复同步幂等

1. 复用同一 `offlineOrderId` 再次提交，或将本地订单临时改回 `PENDING` 后再次同步。
2. 服务端应返回 `DUPLICATE` 或已有 `serverSaleRecordId`。
3. 不应重复创建 `SaleRecord`。
4. 本地订单应仍标记为 `SYNCED`。

## 测试 7：失败订单

可以构造异常订单验证失败行为：

- 空 items。
- 非 CASH。
- 金额不一致。
- storeCode 不匹配。

期望：

- 本地订单标记为 `FAILED`。
- `syncAttemptCount` 增加。
- `lastSyncError` 写入错误原因。
- 订单不会被删除。
- 后续可重试。

## 回归检查

- 在线 CASH 仍正常。
- 在线 KHQR 仍正常。
- `/records` 可看到同步后的正式销售记录。
- 本阶段 `/records` 不要求显示“离线补同步”标签。
- dashboard 统计口径本阶段不调整。
- PWA 桌面打开仍可恢复 `storeCode`。

## 当前边界

- 不自动同步。
- 不删除已同步本地订单。
- 不实现失败详情面板。
- 不实现同步历史清理。
- 不实现 `/records` 离线补同步标签。
- 不调整 dashboard 统计口径。
