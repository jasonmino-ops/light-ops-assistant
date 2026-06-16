# Cashier-Offline-03A 离线订单同步设计确认

## 1. Offline-03 产品目标

Offline-03 的目标是将 Offline-02 中保存在浏览器 IndexedDB 的离线 CASH 订单上传到服务端，并由服务端生成正式销售记录。

核心目标：

- 将 IndexedDB 中的离线 CASH 订单上传到服务端。
- 服务端生成正式 SaleRecord。
- `/records` 可看到补同步后的离线订单。
- dashboard 统计可纳入补同步订单。
- 防止重复上传、重复入账、重复扣库存。
- 第一版只支持 CASH 离线订单同步。

第一版不支持：

- KHQR 离线同步。
- 会员储值离线扣款。
- 优惠券离线核销。
- 退款离线同步。
- AI 拍照识别离线结果同步。
- 顾客 H5 离线下单同步。

Offline-03 的目标不是做完整离线 POS，而是先完成“断网 CASH 本地记账 -> 恢复网络后安全补账”的最小闭环。

## 2. 同步边界

### 允许同步

仅允许同步满足以下条件的订单：

- `paymentMethod = CASH`。
- `paymentStatus = PAID_OFFLINE`。
- `syncStatus = PENDING / FAILED`。
- 当前 `storeId / storeCode` 与登录上下文匹配。
- 有合法 `offlineOrderId`。
- 有合法 `deviceId`。
- `items` 非空。
- `totalAmount > 0`。

### 不允许同步

以下情况不得同步：

- KHQR 离线订单。
- AI 拍照识别结果。
- 优惠券核销。
- 会员储值扣款。
- 退款。
- 跨门店订单。
- 缺少 `offlineOrderId` 的订单。
- 缺少 `deviceId` 的订单。
- 商品 `items` 为空的订单。
- `storeId / storeCode / tenantId` 与当前上下文不匹配的订单。
- 价格、金额结构明显非法的订单。

## 3. 服务端 API 设计

建议接口：

```http
POST /api/cashier/offline-sync
```

请求字段：

```json
{
  "storeId": "store-id",
  "storeCode": "ST169E7000",
  "deviceId": "cashier-device-id",
  "orders": []
}
```

`orders[]` 至少包含：

- `offlineOrderId`
- `tenantId`
- `storeId`
- `storeCode`
- `operatorUserId`
- `operatorName`
- `deviceId`
- `createdAtLocal`
- `createdAtClientTimestamp`
- `items`
- `subtotal`
- `discountAmount`
- `totalAmount`
- `paymentMethod`
- `paymentStatus`
- `appVersion`
- `cacheVersion`

`items[]` 至少包含：

- `productId`
- `productName`
- `barcode`
- `unitPrice`
- `quantity`
- `lineTotal`
- `snapshotPrice`
- `snapshotName`

返回字段：

```json
{
  "total": 3,
  "successCount": 2,
  "duplicateCount": 1,
  "failedCount": 0,
  "results": []
}
```

`results[]` 至少包含：

- `offlineOrderId`
- `status: SYNCED / DUPLICATE / FAILED`
- `serverSaleRecordId`
- `errorCode`
- `errorMessage`

接口要求：

- 只允许当前门店上下文同步当前门店订单。
- 支持批量上传。
- 支持部分成功、部分失败。
- 支持幂等。
- 不允许客户端传入任意 tenant/store 后跨店同步。
- 不允许同步为 KHQR / REFUND / COUPON / MEMBER_BALANCE。
- 不允许客户端直接决定正式 SaleRecord 编号。

## 4. 幂等策略

建议幂等主键：

```text
storeId + deviceId + offlineOrderId
```

规则：

- 同一 `offlineOrderId` 重复上传不能重复生成 SaleRecord。
- 服务端发现已同步过，应返回 `DUPLICATE` 和已有 `serverSaleRecordId`。
- 客户端收到 `DUPLICATE` 后也应将本地订单标记为 `SYNCED`。
- 网络中断导致客户端没收到响应时，再次上传应安全返回已有结果。
- 重试不能造成重复入账。
- 重试不能重复扣库存。
- 重试不能重复生成 `/records` 记录。

推荐服务端处理顺序：

1. 校验当前登录上下文。
2. 校验 `storeId / storeCode / tenantId`。
3. 校验订单合法性。
4. 按 `storeId + deviceId + offlineOrderId` 查询是否已同步。
5. 如果已存在，返回 `DUPLICATE`。
6. 如果不存在，在数据库事务中创建正式销售记录和同步映射。
7. 返回 `SYNCED`。

## 5. 数据库设计建议

本轮只写设计建议，不执行 migration。

### 方案 A：在 SaleRecord 增加离线同步字段

可能字段：

- `offlineOrderId`
- `offlineDeviceId`
- `offlineCreatedAtLocal`
- `offlineSyncedAt`
- `source: CASHIER_OFFLINE`

唯一约束建议：

```text
storeId + offlineDeviceId + offlineOrderId
```

优点：

- 查询 `/records` 时直接可读来源字段。
- 不需要额外 join。
- 实现简单，离线补同步记录天然跟 SaleRecord 放在一起。

缺点：

- SaleRecord 模型会继续膨胀。
- 后续如果有更多离线同步审计字段，会污染销售主表。
- 原始 payload hash、同步尝试次数等审计信息不适合放在 SaleRecord。

### 方案 B：新增 OfflineSaleSyncMap 表

可能字段：

- `id`
- `tenantId`
- `storeId`
- `deviceId`
- `offlineOrderId`
- `saleRecordId`
- `syncedAt`
- `rawPayloadHash`
- `createdAt`

唯一约束建议：

```text
storeId + deviceId + offlineOrderId
```

优点：

- 幂等映射独立，审计边界清楚。
- 不污染 SaleRecord 主表。
- 可以记录 payload hash、同步来源、同步设备等信息。
- 后续支持离线同步排障更方便。

缺点：

- `/records` 显示来源标签时可能需要额外查询或在 SaleRecord 增加轻量 source 字段。
- 实现比方案 A 稍复杂。

### 推荐方案

推荐采用混合方案：

1. 新增 `OfflineSaleSyncMap` 作为幂等和审计主表。
2. 在 SaleRecord 上增加最小来源字段，例如 `source = CASHIER_OFFLINE` 或 `sourceType`，用于 `/records` 轻量展示。
3. 幂等唯一约束落在 `OfflineSaleSyncMap(storeId, deviceId, offlineOrderId)`。

理由：

- 幂等和审计必须稳定，适合独立表。
- `/records` 需要高频展示来源标签，SaleRecord 需要有轻量来源字段避免复杂查询。
- 后续排查重复入账、漏账、同步失败时，映射表比把所有字段塞进 SaleRecord 更清晰。

## 6. `/records` 补账口径

同步成功后的离线订单建议进入 `/records`。

展示建议：

- 显示来源标签：`离线补同步`。
- 显示支付方式：`CASH`。
- 显示同步状态：如需要可显示 `已补同步`。
- 不显示为 KHQR。
- 不显示为顾客 H5 订单。

时间口径：

- 销售发生时间优先使用 `createdAtClientTimestamp / createdAtLocal`。
- 同步时间单独记录为 `syncedAt`。
- `/records` 排序建议按销售发生时间排序。
- 如果排序按发生时间导致新同步的旧订单不在顶部，应在列表或详情中清楚显示 `离线补同步` 和 `同步时间`。

避免误解：

- 老板不应误以为昨天断网销售是今天刚发生的新订单。
- 记录详情中建议展示：
  - 销售时间。
  - 同步时间。
  - 来源：离线补同步。
  - 设备 ID 短码。

## 7. dashboard 统计口径

离线订单同步成功后应进入 dashboard 经营统计。

推荐口径：

- 归属日期按销售发生时间 `createdAtLocal / createdAtClientTimestamp`，不是同步时间。
- 如果昨天离线销售今天同步，应计入昨天销售额。
- 今日 dashboard 不应因为今天同步昨天订单而虚增今日销售。

客户端时间异常处理：

- 如果客户端时间明显异常，例如早于门店创建时间、晚于当前服务器时间太多，应标记为时间异常。
- 时间异常订单可以：
  - 同步成功但标记 `TIME_SKEW_REVIEW`，进入人工复核。
  - 或同步失败，要求人工处理。

第一版建议：

- 若客户端时间偏差在合理范围内，按客户端销售发生时间入账。
- 若时间明显异常，仍优先保留订单数据，但在 `/records` 标记异常，dashboard 可暂按同步当天或人工确认后归档。

是否需要 dashboard 提示：

- 建议后续增加“离线补同步金额 / 笔数”轻提示。
- 第一版可以先不做复杂 dashboard 组件，但统计口径必须明确按销售发生时间归属。

## 8. 库存处理策略

离线收银时不扣服务器库存。同步时才进入服务端正式销售处理。

### 方案 A：库存不足也生成销售记录，并标记库存异常

优点：

- 优先保证现金销售流水补账。
- 符合真实门店场景：现金已经收了，不能因为库存不足丢账。
- 后续由老板处理库存异常。

缺点：

- 库存可能短时间为负或异常。
- 需要 `/records` 或后台提示库存异常。

### 方案 B：库存不足则同步失败，要求人工处理

优点：

- 库存数据更保守。
- 不会自动产生库存异常销售记录。

缺点：

- 现金已经收款但系统不入账，容易漏账。
- 店员可能忽略失败订单。
- 不符合“不断卖、可补账”的第一目标。

### 推荐策略

推荐第一版采用方案 A：

- 同步时即使库存不足，也生成正式 SaleRecord。
- 标记来源为 `CASHIER_OFFLINE`。
- 如有库存不足，标记 `STOCK_REVIEW_REQUIRED` 或类似异常。
- records 详情显示库存异常提示。
- 后续由老板在商品库存或 records 中人工处理。

理由：

- 离线 CASH 的第一目标是补销售流水。
- 库存可以后续修正，现金流水丢失更危险。

## 9. 失败订单处理

| 失败场景 | 建议 errorCode | 可重试 | 是否人工处理 | 客户端展示 |
| --- | --- | --- | --- | --- |
| 服务端校验失败 | INVALID_OFFLINE_ORDER | 否 | 是 | 订单格式异常，请联系管理员 |
| 商品不存在 | PRODUCT_NOT_FOUND | 否 | 是 | 商品不存在，需要人工处理 |
| 商品已下架 | PRODUCT_INACTIVE | 可配置 | 是 | 商品已下架，需要人工确认 |
| 价格变更 | PRICE_CHANGED | 是 | 可选 | 商品价格已变化，请确认后重试 |
| 库存不足 | STOCK_INSUFFICIENT | 视策略 | 是 | 库存不足，订单需人工复核 |
| storeId/storeCode 不匹配 | STORE_MISMATCH | 否 | 是 | 门店不匹配，禁止同步 |
| operatorUserId 无效 | OPERATOR_INVALID | 否 | 是 | 操作员无效，需管理员处理 |
| tenantId 不匹配 | TENANT_MISMATCH | 否 | 是 | 租户不匹配，禁止同步 |
| 重复订单 | DUPLICATE_OFFLINE_ORDER | 否 | 否 | 已同步过，已标记完成 |
| 网络中断 | NETWORK_ERROR | 是 | 否 | 网络异常，稍后重试 |
| 部分成功、部分失败 | PARTIAL_FAILED | 是 | 视失败项 | 部分订单同步失败，可查看原因 |

处理原则：

- `DUPLICATE_OFFLINE_ORDER` 应视为成功结果，客户端标记 `SYNCED`。
- `NETWORK_ERROR` 保留本地订单，可重试。
- 跨租户 / 跨门店 / 缺字段类错误不得自动重试。
- 价格和库存类错误需要保留原订单，不得删除。
- 失败订单必须留在 IndexedDB，不能自动丢弃。

## 10. 客户端同步流程

建议第一版使用手动同步，不自动同步。

流程：

1. 用户恢复网络。
2. 页面显示“有 X 笔离线订单待同步”。
3. 店员点击“同步离线订单”。
4. 客户端扫描 IndexedDB 中 `PENDING / FAILED` 订单。
5. 批量调用 `POST /api/cashier/offline-sync`。
6. 单笔 `SYNCED` 标记本地订单为 `SYNCED`。
7. 单笔 `DUPLICATE` 也标记本地订单为 `SYNCED`。
8. 单笔 `FAILED` 保留本地订单，写入 `lastSyncError`。
9. 不删除本地订单，只更新 `syncStatus`。
10. 后续可单独增加清理已同步订单功能。

为什么第一版不自动同步：

- 避免网络刚恢复但不稳定时产生半成功状态。
- 给店员明确心理预期。
- 方便真机试跑观察同步结果。
- 避免在不知情情况下把异常订单推入 records/dashboard。

## 11. UI 设计建议

需要包含：

- 待同步订单数量。
- 同步按钮。
- 同步中状态。
- 同步成功 X 笔。
- 同步失败 X 笔。
- 查看失败原因。
- 离线补同步订单提示。
- 不允许同步时的提示。
- 同步前二次确认。

建议文案：

- `有 X 笔离线订单待同步`
- `同步离线订单`
- `正在同步...`
- `已同步 X 笔`
- `X 笔同步失败，请查看原因`
- `离线补同步订单会进入销售记录，并按销售发生时间统计`

二次确认建议：

- 第一版建议需要二次确认。
- 确认弹层说明：
  - 本次会上传 X 笔 CASH 离线订单。
  - 成功后会进入 `/records`。
  - 失败订单会保留在本机。

## 12. 安全与审计

建议记录：

- OperationLog：建议记录批量同步行为。
- `rawPayloadHash`：建议记录每笔离线订单 payload hash。
- `deviceId`：必须记录。
- `appVersion / cacheVersion`：建议记录。
- `operatorUserId`：必须记录。
- `storeId / tenantId`：必须记录。
- 同步 IP / userAgent：如当前项目已有类似能力则沿用。
- `offlineOrderId`：必须记录。
- `serverSaleRecordId`：必须记录。
- `syncedAt`：必须记录。

审计目标：

- 排查重复入账。
- 排查漏账。
- 判断订单来自哪台收银电脑。
- 判断离线订单使用的是哪个缓存版本。
- 判断是否存在客户端时间异常。

建议：

- 批量同步写一条 OperationLog。
- 每笔同步结果在 `OfflineSaleSyncMap` 中记录。
- 如果某笔失败，不写 SaleRecord，但记录失败原因到响应和本地 IndexedDB。

## 13. Offline-03 分阶段建议

### Offline-03B：数据库字段/表方案落地

- 新增 `OfflineSaleSyncMap`。
- SaleRecord 增加最小来源字段。
- 增加唯一约束：`storeId + deviceId + offlineOrderId`。
- 不接前端同步按钮。

已落地内容：

- 新增 Prisma model：`OfflineSaleSyncMap`。
- 新增 migration：`20260617010000_add_cashier_offline_sync_map`。
- `OfflineSaleSyncMap` 字段包含 `tenantId / storeId / deviceId / offlineOrderId / saleRecordId / status / syncedAt / rawPayloadHash / lastErrorCode / lastErrorMessage / createdAt / updatedAt`。
- 已增加唯一约束：`@@unique([storeId, deviceId, offlineOrderId])`。
- 已增加索引：`tenantId / storeId / saleRecordId / status / createdAt`。
- SaleRecord 已增加最小离线来源字段：
  - `source`
  - `offlineOrderId`
  - `offlineDeviceId`
  - `offlineCreatedAtLocal`
  - `offlineCreatedAtClientTimestamp`
  - `offlineSyncedAt`
  - `offlineSyncStatus`
  - `inventoryException`
- SaleRecord 新增字段均为 nullable，不影响历史销售记录和在线销售创建。
- 本阶段仍未实现 `/api/cashier/offline-sync`。
- 本阶段仍未改 `/cashier` 同步逻辑。
- 本阶段仍未改 `/records` 展示。
- 本阶段仍未改 dashboard 统计。

### Offline-03C：服务端 offline-sync API

- 新增 `POST /api/cashier/offline-sync`。
- 实现校验、幂等、批量同步。
- 成功生成正式 SaleRecord。
- DUPLICATE 返回已有 SaleRecord。

### Offline-03D：客户端手动同步按钮

- `/cashier` 显示同步按钮。
- 手动上传 PENDING / FAILED。
- 写回 IndexedDB 状态。
- 不自动删除已同步订单。

### Offline-03E：`/records` 显示“离线补同步”标签

- records 列表和详情显示来源标签。
- 显示销售发生时间和同步时间。
- 可选显示库存异常提示。

### Offline-03F：真实门店断网同步试跑与冻结

- 选择 Mino Pet Shop 或指定门店试跑。
- 验证断网 CASH 收银。
- 验证恢复网络后手动同步。
- 验证 records/dashboard 补账。
- 验证重复上传不重复入账。

## 14. 安全边界

Offline-03A 本轮不允许：

- 改数据库 schema。
- 新增 Prisma migration。
- 新增 `/api/cashier/offline-sync`。
- 改 `/cashier` 同步逻辑。
- 改 `/records`。
- 改 dashboard。
- 改库存逻辑。
- 改 CASH / KHQR 在线流程。

Offline-03A 本轮只允许：

- 新增 Offline-03A 设计文档。
- 更新 `docs/architecture/CASHIER_OFFLINE_MODE_DESIGN.md` 中 Offline-03 章节。
- 追加 Obsidian 开发记录。

## 15. 结论

Offline-03 可以进入后续分阶段实现，但不建议直接一次性开发完整同步闭环。

推荐先做 Offline-03B：

- 新增 `OfflineSaleSyncMap`。
- SaleRecord 增加最小来源字段。
- 明确唯一约束和补账来源标签。

数据库方案推荐：

- 采用 `OfflineSaleSyncMap` 作为幂等与审计主表。
- SaleRecord 仅保留最小来源字段，便于 `/records` 展示。

补账口径推荐：

- `/records` 显示“离线补同步”标签。
- dashboard 按销售发生时间归属统计。
- 库存不足时优先保留销售流水并标记库存异常。
