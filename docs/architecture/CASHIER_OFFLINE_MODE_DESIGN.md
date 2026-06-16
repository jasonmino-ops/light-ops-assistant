# /cashier 离线收银模式设计方案

## 1. 产品目标

为店小二电脑端收银台设计“断网情况下至少可以 CASH 现金收银，恢复网络后自动同步”的最小可行方案。

- 门店电脑断网时，`/cashier` 仍可进行最小 CASH 收银。
- 恢复网络后，离线订单自动同步到服务器。
- 避免重复上传、重复入账、乱账和误扣库存。
- 第一阶段只保证“不断卖、可补账”，不追求所有在线能力离线可用。

## 2. 离线模式边界

### 离线时允许

- 使用本地缓存商品。
- 搜索商品。
- 扫码选择商品，如果扫码能力本身不依赖服务器。
- 修改数量。
- CASH 收款。
- 生成本地离线订单。
- 查看待同步订单数量。
- 查看离线订单同步状态。

### 离线时不允许

- KHQR 自动确认。
- AI 拍照识别。
- 优惠券核销。
- 顾客 H5 下单。
- 老板实时 Dashboard。
- 云打印自动任务。
- 跨设备库存强一致扣减。
- 会员储值扣款。
- 退款自动入账。

## 3. 本地缓存方案

建议使用 IndexedDB。

需要缓存：

- store 信息。
- tenantId。
- storeId。
- storeCode。
- operator 信息。
- product 列表。
- 商品价格。
- 商品条码。
- 商品分类。
- 商品状态。
- lastSyncAt。
- appVersion。
- cacheVersion。
- deviceId。

说明：

- 每次联网进入 `/cashier` 时刷新商品缓存。
- 缓存成功后页面显示“商品数据已缓存”。
- 缓存过旧时需要提醒店员。
- 不在 localStorage 保存大批商品数据，商品和订单使用 IndexedDB。

## 4. 离线订单字段设计

离线订单至少包含：

- offlineOrderId。
- tenantId。
- storeId。
- storeCode。
- operatorUserId。
- operatorName。
- deviceId。
- createdAtLocal。
- createdAtClientTimestamp。
- items。
- subtotal。
- discountAmount。
- totalAmount。
- paymentMethod: CASH。
- paymentStatus: PAID_OFFLINE。
- syncStatus: PENDING / SYNCING / SYNCED / FAILED。
- syncAttemptCount。
- lastSyncError。
- serverSaleRecordId。
- syncedAt。
- appVersion。
- cacheVersion。

items 至少包含：

- productId。
- productName。
- barcode。
- unitPrice。
- quantity。
- lineTotal。
- snapshotPrice。
- snapshotName。

## 5. offlineOrderId 生成规则

建议格式：

```text
OFFLINE-{storeCode}-{deviceId短码}-{yyyyMMddHHmmss}-{随机4位}
```

要求：

- 同一设备不重复。
- 支持断网状态下生成。
- 服务端可用于幂等判断。
- 不依赖服务器时间。

## 6. 同步流程

### 联网状态

- `/cashier` 正常创建正式 SaleRecord。
- records/dashboard 实时更新。

### 断网状态

- 检测到 offline 或 API 请求失败。
- 页面切换到“离线收银模式”。
- 只允许 CASH。
- 订单写入 IndexedDB。
- 显示“有 X 笔离线订单待同步”。

### 恢复网络

- 检测到 online。
- 扫描 IndexedDB 中 PENDING / FAILED 订单。
- 调用服务端同步接口。
- 成功后标记 SYNCED。
- 保存 serverSaleRecordId。
- 失败后保留本地订单并展示错误。
- 不允许自动删除失败订单。

## 7. 服务端同步接口设计

只设计，不实现。

建议接口：

```http
POST /api/cashier/offline-sync
```

请求：

- storeId。
- storeCode。
- deviceId。
- orders[]。

返回：

- total。
- successCount。
- failedCount。
- results[]。

每笔结果包含：

- offlineOrderId。
- status: SYNCED / DUPLICATE / FAILED。
- serverSaleRecordId。
- errorCode。
- errorMessage。

要求：

- 支持批量上传。
- 支持幂等。
- 使用 offlineOrderId + storeId + deviceId 防重复。
- 重试不会重复生成销售记录。
- 同一订单多次上传只返回已有 serverSaleRecordId。

## 8. 数据库唯一性建议

只做设计建议，不执行 migration。

建议后续服务端需要在销售记录或离线同步映射表中记录：

- offlineOrderId。
- deviceId。
- storeId。
- syncedAt。

并考虑唯一约束：

```text
storeId + deviceId + offlineOrderId
```

## 9. 库存处理策略

第一版建议：

- 离线时不强扣服务器库存。
- 本地只按缓存商品展示和收银。
- 同步成功后再走服务端正式销售记录逻辑。
- 如果同步时库存不足，订单仍保留为异常待处理，不直接丢弃。
- 后台或 records 需要标记“离线同步订单 / 库存异常”。
- 第一版优先保证销售流水补账，不追求库存完全强一致。

## 10. UI 提示设计

需要包含：

- 当前在线 / 离线状态。
- 商品缓存时间。
- 当前是否可离线收银。
- 离线模式下只允许 CASH 的提示。
- 待同步订单数量。
- 同步中。
- 同步成功。
- 同步失败。
- KHQR 离线不可用提示。
- 缓存商品过旧提示。
- 浏览器存储异常提示。

## 11. 风险点

- 多台收银机同时离线导致库存冲突。
- 商品价格变更后离线订单仍按旧价销售。
- 电脑清缓存导致离线订单丢失。
- 店员重复收银。
- 浏览器存储空间限制。
- 电脑系统时间不准确。
- PWA 被卸载导致本地订单丢失。
- 同一门店多设备同步顺序不一致。
- 离线订单同步失败后店员忽略提醒。
- 断网时无法确认 KHQR 是否到账。

## 12. 分阶段开发计划

### Offline-01：商品缓存与在线/离线状态提示

- 只缓存商品。
- 显示缓存时间。
- 显示当前网络状态。
- 不创建离线订单。

已实现内容：

- IndexedDB 商品缓存：`cashier_products`。
- IndexedDB 缓存 meta：`cashier_meta`。
- `/cashier` 联网加载商品成功后写入商品缓存。
- 页面显示在线/离线状态。
- 页面显示商品缓存数量和上次缓存时间。
- 离线状态只提示“本阶段仅支持查看已缓存商品，暂不支持离线收银”。
- 本阶段不创建离线订单、不上传同步、不开放离线 CASH 收银。

### Offline-02：离线 CASH 订单本地保存

- 断网时允许 CASH 收银。
- 订单写入 IndexedDB。
- 显示待同步数量。
- 不自动上传。

已实现内容：

- IndexedDB 新增 `cashier_offline_orders`。
- 离线且当前门店已有商品缓存时允许从缓存商品加入购物车。
- 离线模式只允许 CASH，不允许 KHQR。
- 离线 CASH 完成后生成本地离线订单，`syncStatus=PENDING`。
- 页面显示待同步离线订单数量。
- 恢复网络后只提示有待同步订单，不自动上传。
- 本阶段不新增服务端同步接口，不创建 SaleRecord，不进入 `/records`。

### Offline-03：离线订单同步接口与幂等

- 新增 `POST /api/cashier/offline-sync`。
- 服务端防重复。
- 成功后生成正式销售记录。

### Offline-04：待同步订单面板

- 可查看待同步 / 同步失败订单。
- 可手动重试。
- 可查看错误原因。

### Offline-05：真实门店试跑与冻结

- 选择 Mino Pet Shop 或指定门店试跑。
- 验证断网 CASH 收银。
- 验证恢复网络后自动同步。
- 验证 records/dashboard 补账。

## 13. 安全边界

本轮不允许修改：

- 数据库 schema。
- Prisma migration。
- `/cashier` 业务代码。
- sale / records / KHQR / AI / invite。
- 任何生产业务逻辑。

本轮只允许：

- 追加冻结记录。
- 新增离线收银设计文档。
