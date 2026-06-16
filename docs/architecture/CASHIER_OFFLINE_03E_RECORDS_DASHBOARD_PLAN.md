# Cashier Offline-03E：/records 离线补同步展示与 dashboard 口径规划

## 一、Offline-03E 产品目标

Offline-03E 的目标是让老板和店员在 `/records` 中清楚识别哪些订单是离线后补同步的，避免把“同步时间”误认为“销售发生时间”。

本阶段规划目标：

- `/records` 能识别并展示“离线补同步”订单。
- 保留真实销售发生时间和同步时间。
- dashboard 统计尽量按销售发生时间归属。
- 第一版不做复杂财务重算，只做清晰展示和低风险提示。

当前边界：

- 本文档只做规划。
- 不修改 `/records`。
- 不修改 dashboard。
- 不修改数据库。
- 不修改生产业务逻辑。

## 二、/records 当前状态取证

### 数据来源

`/records` 页面调用：

```text
GET /api/records?dateFrom=yyyy-MM-dd&dateTo=yyyy-MM-dd&page=1&pageSize=50
```

`app/api/records/route.ts` 当前数据来源：

- `SaleRecord`
- 已完成且已支付的 `CustomerOrder`

其中：

- `SaleRecord` 使用 `createdAt` 做日期过滤。
- `CustomerOrder` 使用 `paidAt` 做日期过滤。
- 首页页码 `page=1` 时会合并 H5 顾客订单。
- STAFF 视角会按当前 `ctx.storeId + ctx.userId` 强约束。
- OWNER 可按 `storeId / operatorUserId` 筛选。

### SaleRecord 当前展示字段

`/records` 当前返回并展示的核心字段包括：

- `recordNo`
- `orderNo`
- `createdAt`
- `storeName`
- `operatorDisplayName`
- `productNameSnapshot`
- `specSnapshot`
- `quantity`
- `unitPrice`
- `lineAmount`
- `saleType`
- `refundReason`
- `remark`
- `paymentMethod`
- `paymentStatus`
- `source`

当前 `source` 是前端聚合来源：

- `SALE_RECORD`
- `CUSTOMER_ORDER`

这不是 `SaleRecord.source` 原始字段。

### 当前排序

后端：

- `SaleRecord.findMany()` 使用 `orderBy: { createdAt: 'desc' }`。
- 合并 `CustomerOrder` 后按返回行的 `createdAt` 字符串倒序排序。

前端：

- `buildEntries()` 再按 `createdAt` 倒序聚合和排序。

因此当前排序口径是展示行的 `createdAt`。

### dashboard 当前口径

`/dashboard` 调用：

```text
GET /api/summary
```

`app/api/summary/route.ts` 当前口径：

- `SaleRecord` 使用 `createdAt` 做日期过滤。
- `CustomerOrder` 使用 `paidAt` 做日期过滤。
- `SaleRecord` 和 `CustomerOrder` 合并计算销售额、笔数、CASH / KHQR、热销商品。

dashboard 当前与 `/records` 对齐，仍主要依赖 `SaleRecord.createdAt`。

### 当前离线字段

`SaleRecord` 已存在 Offline-03B 字段：

- `source`
- `offlineOrderId`
- `offlineDeviceId`
- `offlineCreatedAtLocal`
- `offlineCreatedAtClientTimestamp`
- `offlineSyncedAt`
- `offlineSyncStatus`
- `inventoryException`

Offline-03C 同步成功后会写入：

- `source = CASHIER_OFFLINE`
- `offlineOrderId`
- `offlineDeviceId`
- `offlineCreatedAtLocal`
- `offlineCreatedAtClientTimestamp`
- `offlineSyncedAt`
- `offlineSyncStatus = SYNCED`

## 三、离线补同步订单识别规则

可用识别条件：

1. `SaleRecord.source = CASHIER_OFFLINE`
2. `SaleRecord.offlineOrderId` 不为空
3. `SaleRecord.offlineSyncStatus = SYNCED`

评估：

- `offlineOrderId` 最稳，因为它来自离线订单幂等主键，是离线补同步订单的业务身份。
- `source = CASHIER_OFFLINE` 可读性最好，适合 UI 和统计语义。
- `offlineSyncStatus = SYNCED` 可作为辅助条件，但如果后续存在异常状态，不应单独依赖它。

推荐第一版识别规则：

```text
isOfflineSynced = offlineOrderId != null OR source == CASHIER_OFFLINE
```

## 四、/records 标签展示方案

建议在记录行中增加轻量标签：

- 中文：离线补同步
- 英文：Offline synced
- 柬语：第一版可按现有 i18n 规则补充；如翻译未确认，可先使用接近英文语义的短文案。

展示位置：

- 订单标题右侧，靠近 `销售单 / 顾客订单 / 退款单` 标签。
- 或支付方式 / 来源标签附近。

视觉要求：

- 使用浅橙或浅蓝灰标签。
- 不占用太大空间。
- 不影响普通在线订单显示。
- 不把离线补同步做成危险状态，避免误导店员认为订单异常。

## 五、时间展示口径

需要区分两个时间：

### 1. 销售发生时间

优先级：

```text
offlineCreatedAtClientTimestamp || createdAt
```

用途：

- 记录主时间展示。
- 后续排序口径候选。
- 后续 dashboard 归属口径候选。

### 2. 同步时间

使用：

```text
offlineSyncedAt
```

用途：

- 辅助说明。
- 文案建议：
  - 中文：离线销售，已于 HH:mm 同步
  - 英文：Offline sale, synced at HH:mm

推荐展示：

- 主时间显示销售发生时间。
- 离线补同步订单额外显示同步时间。
- 不把同步时间替代销售发生时间。

## 六、排序口径

候选方案：

1. 继续按 `SaleRecord.createdAt` 排序。
2. 改为按 `offlineCreatedAtClientTimestamp || createdAt` 排序。
3. 后端返回 `displayTime`，前端和后端统一按 `displayTime` 排序。

风险评估：

- 直接改排序会影响 `/records` 已有分页、缓存和合并 H5 订单的行为。
- 如果后端只在当前 page 中按 displayTime 排序，但数据库分页仍按 `createdAt`，可能出现跨页顺序不严格。
- 真正准确的 displayTime 排序需要调整查询和分页策略，风险高于标签展示。

推荐路线：

- Offline-03E-1：先只显示“离线补同步”标签、销售发生时间、同步时间，不改排序。
- Offline-03E-2：单独评估 records 排序口径。如果风险可控，再引入 `displayTime`。

## 七、dashboard 统计口径

关键问题：

- 离线订单同步成功后会生成 `SaleRecord`。
- 当前 dashboard 可能已经按 `SaleRecord.createdAt` 自动纳入统计。
- 如果离线订单发生在昨天、今天同步，当前统计可能归到同步当天，而不是销售发生当天。

推荐第一版：

- Offline-03E 不调整 dashboard 统计口径。
- Offline-03E 只做 `/records` 标签和时间展示规划。
- dashboard 统计口径调整单独放到 Offline-03F。

后续 dashboard 可考虑增加：

- “含离线补同步 X 笔 / $X”
- 按 `offlineCreatedAtClientTimestamp || createdAt` 归属销售日期。
- 当客户端时间异常时，标记为“时间异常补同步订单”。

## 八、records 与 dashboard 风险点

1. 离线订单发生在昨天，今天才同步，统计归属可能错位。
2. 客户端电脑时间不准确，导致销售发生时间不可靠。
3. 老板看到今日销售增加，但实际发生在昨天。
4. 幂等已防止重复入账，但展示层仍需要避免重复聚合。
5. 同步失败订单暂不会进入 `/records`。
6. 离线补同步标签过多可能影响列表可读性。
7. 多门店场景下 `storeId` / `storeCode` 归属必须正确。
8. 操作员显示可能来自在线 fallback 或离线 snapshot，不一定完全等同真实店员。
9. 如果未来调整 dashboard 口径，需要同步 `/api/summary` 和 `/api/records` 的日期逻辑。

## 九、推荐实现范围

Offline-03E 真正实现时建议只做低风险内容。

允许：

- `/records` 显示“离线补同步”标签。
- `/records` 显示离线销售发生时间。
- `/records` 显示同步时间。
- i18n 补充标签文案。
- 文档和测试指南。

暂不做：

- dashboard 复杂统计重算。
- records 大改排序。
- 离线订单失败处理面板。
- 已同步本地订单清理。
- 财务报表重算。
- 库存异常处理界面。

## 十、建议开发拆分

1. Offline-03E-1：`/records` 离线补同步标签和时间展示。
2. Offline-03E-2：records 排序口径评估，如风险低再改。
3. Offline-03F：dashboard 离线补同步提示与统计口径。
4. Offline-03G：同步失败订单与库存异常运营面板。
5. Offline-04：已同步本地订单清理与长期维护。

## 十一、测试计划

真实测试点：

1. 创建一笔离线 CASH 订单。
2. 手动同步成功。
3. `/records` 显示该订单。
4. `/records` 有“离线补同步”标签。
5. 能看到销售发生时间。
6. 能看到同步时间。
7. 在线 CASH 订单不显示该标签。
8. KHQR 订单不受影响。
9. 多门店记录不串。
10. records 页面无报错。

## 十二、Obsidian 同步

本规划需同步到真实 Obsidian：

```text
/Users/jason/E-Life-Knowledge-Base/E-life knowledge Base/05-开发记录/商户端收口记录-2026-06.md
```

记录内容：

- 阶段名称：Cashier-Offline-03E 规划。
- 本轮目标：`/records` 离线补同步展示口径规划。
- 推荐 `/records` 展示方案。
- 推荐时间口径。
- dashboard 是否本轮处理。
- 是否改数据库：否。
- 是否改业务逻辑：否。

## 十三、安全边界

本轮只允许：

- 新增 Offline-03E 规划文档。
- 更新 Offline-03 同步设计文档，如有必要。
- 追加 Obsidian 记录。

本轮不允许：

- 改 `/records`。
- 改 dashboard。
- 改 `/cashier`。
- 改 offline-sync API。
- 改数据库 schema。
- 新增 migration。
- 改 CASH / KHQR / AI / 优惠券 / 会员 / 退款逻辑。

## 十四、规划结论

Offline-03E 建议先做 `/records` 低风险展示增强：

- 使用 `offlineOrderId != null OR source = CASHIER_OFFLINE` 识别离线补同步订单。
- 显示“离线补同步”标签。
- 主时间优先展示离线销售发生时间。
- 辅助展示同步时间。
- 暂不改 records 排序。
- 暂不改 dashboard 统计口径。

dashboard 离线补同步统计和日期归属建议放到 Offline-03F 单独处理。

## 十五、Offline-03E-1 实现记录

Offline-03E-1 已按低风险范围实现：

- `/api/records` 对 SaleRecord 透传离线来源字段：
  - `saleRecordSource`
  - `offlineOrderId`
  - `offlineCreatedAtClientTimestamp`
  - `offlineSyncedAt`
  - `offlineSyncStatus`
  - `inventoryException`
- `/records` 使用以下规则识别离线补同步订单：
  - `offlineOrderId` 存在；或
  - `saleRecordSource === CASHIER_OFFLINE`
- `/records` 订单卡片显示“离线补同步 / Offline synced”标签。
- `/records` 订单卡片显示：
  - 离线销售时间：`offlineCreatedAtClientTimestamp`
  - 同步时间：`offlineSyncedAt`
- 如果 `inventoryException` 存在，显示“库存异常 / Inventory exception”轻量标签。
- 本轮没有修改 records 排序。
- 本轮没有修改 dashboard。
- 本轮没有修改 `/cashier`。
- 本轮没有修改 offline-sync API。
- 本轮没有修改数据库 schema 或 migration。
