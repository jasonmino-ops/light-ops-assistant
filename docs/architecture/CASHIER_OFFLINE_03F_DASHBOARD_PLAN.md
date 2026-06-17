# Cashier Offline-03F：dashboard 离线补同步提示与统计口径规划

## 一、Offline-03F 产品目标

Offline-03F 的目标是让老板在 dashboard 中知道当前经营数据是否包含离线补同步订单，并避免把“今天同步的订单”误认为“今天发生的销售”。

规划目标：

- 让 dashboard 可以提示本期是否包含离线补同步订单。
- 尽量按销售发生时间理解离线订单，而不是按同步时间。
- 第一版以提示和透明为主，不做复杂财务重算。
- 不影响现有 dashboard 稳定性。

本轮只做规划，不实现代码。

## 二、dashboard 当前实现取证

### 页面与接口

dashboard 页面：

```text
app/dashboard/page.tsx
```

统计接口：

```text
GET /api/summary?dateFrom=yyyy-MM-dd&dateTo=yyyy-MM-dd[&storeId=][&operatorUserId=]
```

接口文件：

```text
app/api/summary/route.ts
```

### 权限与维度

`/api/summary` 只允许 OWNER 访问。

当前维度：

- `GLOBAL`
- `STORE`
- `STAFF`

过滤方式：

- `storeId`：按门店过滤。
- `operatorUserId`：按员工过滤。
- STAFF 维度不合并顾客订单。

### 当前数据来源

当前 summary 合并：

- `SaleRecord`
- `CustomerOrder`，条件为 `status=COMPLETED && paymentStatus=PAID`

当前 CustomerOrder 时间口径：

- 使用 `paidAt` 过滤。

当前 SaleRecord 时间口径：

- 使用 `SaleRecord.createdAt` 过滤。

### 当前统计字段

dashboard 当前展示包括：

- `totalSaleAmount`
- `totalRefundAmount`
- `netAmount`
- `saleCount`
- `refundCount`
- `saleOrderCount`
- `refundOrderCount`
- `topProducts`
- `cashSaleAmount`
- `khqrSaleAmount`
- `customerOrderAmount`

### 支付方式统计

支付拆分由：

```text
getPaymentBreakdown({ tenantId, from, to, storeId, operatorUserId })
```

计算。

当前 payment breakdown 同样基于现有时间区间，未专门处理离线销售发生时间。

### 当前是否读取离线字段

当前 `/api/summary` 没有读取：

- `SaleRecord.source`
- `offlineOrderId`
- `offlineCreatedAtClientTimestamp`
- `offlineSyncedAt`
- `offlineSyncStatus`

因此 dashboard 当前不会识别离线补同步订单。

## 三、离线补同步订单识别规则

沿用 `/records` 规则：

```text
isOfflineSynced =
  SaleRecord.offlineOrderId exists
  OR SaleRecord.source = CASHIER_OFFLINE
```

说明：

- `OfflineSaleSyncMap` 用于幂等和审计。
- dashboard 第一版不需要直接查询 `OfflineSaleSyncMap`。
- 优先从 `SaleRecord` 字段识别，降低查询复杂度。

## 四、统计时间口径

dashboard 涉及三个时间：

### 1. SaleRecord.createdAt

含义：

- 服务端创建正式销售记录的时间。
- 对离线补同步订单来说，可能是同步时间。

风险：

- 如果 6 月 16 日断网销售，6 月 17 日同步，`createdAt` 可能落在 6 月 17 日。

### 2. offlineCreatedAtClientTimestamp

含义：

- 离线销售实际发生时间。
- 来自收银电脑本地时间。

推荐：

- 应作为离线订单的业务发生时间。

### 3. offlineSyncedAt

含义：

- 恢复网络后同步入库时间。

推荐：

- 只用于提示和审计。
- 不默认作为销售归属时间。

推荐口径：

- 普通在线订单：按 `createdAt` 统计。
- 离线补同步订单：按 `offlineCreatedAtClientTimestamp` 统计。
- 如果 `offlineCreatedAtClientTimestamp` 缺失，则 fallback 到 `createdAt`。
- `offlineSyncedAt` 不用于销售归属，只用于提示。

## 五、dashboard 展示建议

第一版建议增加轻量提示，不大改 UI。

可展示：

- 今日含离线补同步：X 笔 / $Y
- 本期有离线补同步订单：X 笔
- 最近同步离线订单：X 笔

展示位置：

- dashboard 今日销售 Hero 卡片下方。
- 或支付方式统计附近。
- 或经营概览底部提示条。

文案建议：

中文：

```text
今日含离线补同步 X 笔，金额 $Y
```

英文：

```text
Includes X offline-synced orders, $Y
```

柬语：

- 后续按项目 i18n 规则补充。
- 本轮只规划，不实现。

## 六、统计归属方案对比

### 方案 A：不改现有 dashboard 统计，只增加提示

做法：

- 保持 `/api/summary` 现有主统计不变。
- 额外返回离线补同步笔数和金额。
- dashboard 展示“本期含离线补同步 X 笔 / $Y”。

优点：

- 风险低。
- 不影响现有 `/api/summary`。
- 不影响已有 dashboard 指标。
- 可快速上线。

缺点：

- 如果 `SaleRecord.createdAt` 是同步时间，历史归属可能不准确。
- 跨日补同步仍可能影响老板对“今日”的理解。

### 方案 B：dashboard 统计改为 displayBusinessTime

规则：

- 离线单使用 `offlineCreatedAtClientTimestamp`。
- 在线单使用 `createdAt`。

优点：

- 统计归属更准确。
- 更符合真实销售发生时间。

缺点：

- 可能影响现有统计逻辑。
- 需要重新验证 records / dashboard / summary。
- 跨日补同步会改变历史数据展示。
- 查询复杂度更高，分页、热销商品、支付拆分都要同步处理。

### 推荐方案

推荐 Offline-03F-1 先采用方案 A：

- 不改主统计。
- 只增加离线补同步提示。
- 不改变原销售额、订单数、支付方式统计。

后续 Offline-03F-2 再评估是否改统计归属。

## 七、跨日补同步场景

场景：

- 6 月 16 日断网卖货。
- 6 月 17 日恢复网络同步。
- `SaleRecord.createdAt` 可能是 6 月 17 日。
- `offlineCreatedAtClientTimestamp` 是 6 月 16 日。

问题：

- dashboard 今日销售应算哪一天？
- 老板看到今日销售增加是否会误解？
- 是否需要提示“含昨日离线补同步”？
- 是否需要后续提供筛选：按销售发生时间 / 按同步时间？

推荐第一版：

- 先在 dashboard 提示“含离线补同步”。
- 不强行改历史统计归属。
- 后续再做准确归属。

后续增强：

- dashboard 可增加：
  - “含昨日离线补同步 X 笔”
  - “按销售发生时间统计”
  - “按同步时间统计”

## 八、客户端时间异常

风险：

- 电脑时间错误。
- `createdAtClientTimestamp` 明显早于或晚于合理范围。
- 离线订单时间来自本地设备，不一定可信。

建议：

- 如果离线销售时间与同步时间相差超过阈值，例如 7 天，可标记为时间异常。
- dashboard 第一版不处理复杂异常。
- 后续可在 `/records` 或运营面板显示“时间异常”。

## 九、建议实现拆分

1. Offline-03F-1：dashboard 只增加离线补同步提示，不改主统计口径。
2. Offline-03F-2：评估并实现按业务发生时间统计。
3. Offline-03F-3：跨日补同步提示。
4. Offline-03F-4：客户端时间异常提示。
5. Offline-03G：同步失败订单 / 库存异常运营面板。

## 十、Offline-03F-1 推荐范围

真正开发时建议只做：

允许：

- `/api/summary` 返回离线补同步笔数和金额。
- dashboard 显示“含离线补同步 X 笔 / 金额”。
- i18n 补充文案。
- 不改变原今日销售总额计算。
- 不改变原订单数计算。
- 不改变支付方式统计。
- 不改变 records。

不允许：

- 重写 dashboard 统计口径。
- 改历史销售归属。
- 改 records 排序。
- 改 offline-sync API。
- 改数据库。
- 改 `/cashier`。

## 十一、测试计划

规划测试点：

1. 创建一笔离线 CASH 订单并同步。
2. dashboard 正常打开。
3. dashboard 显示离线补同步提示。
4. 普通在线 CASH 不计入离线补同步提示。
5. KHQR 不计入离线补同步提示。
6. 今日销售主卡片不被本轮改变。
7. records 展示仍正常。
8. 多门店数据不串。
9. 老板模式 / 店员权限不受影响。

## 十二、Obsidian 同步

本规划需同步到真实 Obsidian：

```text
/Users/jason/E-Life-Knowledge-Base/E-life knowledge Base/05-开发记录/商户端收口记录-2026-06.md
```

记录内容：

- 阶段名称：Cashier-Offline-03F 规划。
- 本轮目标：dashboard 离线补同步提示与统计归属口径规划。
- 推荐方案。
- 推荐实现范围。
- 是否改数据库：否。
- 是否改业务逻辑：否。

## 十三、安全边界

本轮只允许：

- 新增 Offline-03F 规划文档。
- 更新相关架构文档，如有必要。
- 追加 Obsidian 记录。

本轮不允许：

- 改 dashboard。
- 改 `/api/summary`。
- 改 `/records`。
- 改 `/cashier`。
- 改 offline-sync API。
- 改数据库 schema。
- 新增 migration。
- 改 CASH / KHQR / AI / 优惠券 / 会员 / 退款逻辑。

## 十四、规划结论

Offline-03F 建议先走低风险路线：

- Offline-03F-1 只增加 dashboard 离线补同步提示。
- 不改主统计口径。
- 不改支付方式统计。
- 不改 records。
- 不改数据库。

统计归属口径调整应作为 Offline-03F-2 单独评估和开发。

## 十五、Offline-03F-1 实现记录

Offline-03F-1 已按方案 A 落地：

- `/api/summary` 增加轻量字段 `offlineSyncedSummary`。
- 字段结构：

```json
{
  "offlineSyncedSummary": {
    "count": 1,
    "amount": 5.5
  }
}
```

- 识别条件沿用 records 口径：
  - `SaleRecord.offlineOrderId` 存在；或
  - `SaleRecord.source = CASHIER_OFFLINE`。
- 查询范围沿用 dashboard 当前 `dateFrom/dateTo/storeId/operatorUserId` 过滤。
- 不直接查询 `OfflineSaleSyncMap`，避免增加接口复杂度。
- dashboard 在经营概览附近显示轻提示：
  - 中文：`含离线补同步 X 笔，金额 $Y`
  - English：`Includes X offline-synced orders, $Y`
  - Khmer：本轮先按英文提示补齐 key，避免空 key。

本轮明确未改：

- 今日销售额计算。
- 订单数计算。
- CASH / KHQR / H5 支付结构统计。
- dashboard 日期归属逻辑。
- `/records` 展示与排序。
- `/cashier` 离线收银与同步逻辑。
- 数据库 schema / migration。

后续 Offline-03F-2 再单独评估是否将 dashboard 主统计改为业务发生时间口径：

- 普通在线订单：`createdAt`。
- 离线补同步订单：`offlineCreatedAtClientTimestamp || createdAt`。
