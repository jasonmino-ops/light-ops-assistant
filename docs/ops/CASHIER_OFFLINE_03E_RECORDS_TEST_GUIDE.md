# Cashier Offline-03E-1 /records 离线补同步展示测试指南

## 目标

验证 `/records` 能识别并展示通过 `/cashier` 离线收银后补同步的订单。

本阶段只验证展示：

- 离线补同步标签
- 离线销售时间
- 同步时间
- 普通在线订单不受影响

本阶段不调整 dashboard，不调整 records 排序，不改同步逻辑。

## 前置条件

- Production 已部署 Offline-03E-1。
- Offline-03D 已可手动同步离线订单。
- 使用测试门店：

```text
ST169E7000
```

## 测试 1：创建并同步离线 CASH 订单

1. 联网打开：

```text
/cashier?storeCode=ST169E7000
```

2. 确认商品缓存正常。
3. 断网。
4. 使用缓存商品创建一笔 CASH 离线订单。
5. 确认待同步数量增加。
6. 恢复网络。
7. 点击“同步离线订单”。
8. 确认 IndexedDB 中该订单变为：
   - `syncStatus=SYNCED`
   - `serverSaleRecordId` 有值
   - `syncedAt` 有值

## 测试 2：/records 显示离线补同步标签

1. 打开 `/records`。
2. 找到刚刚同步的订单。
3. 确认记录卡片显示：

```text
离线补同步
```

英文模式应显示：

```text
Offline synced
```

## 测试 3：时间展示

在离线补同步订单卡片中确认：

- 显示离线销售时间。
- 显示同步时间。

中文示例：

```text
离线销售：2026-06-17 10:20
同步于：2026-06-17 10:25
```

英文示例：

```text
Offline sale: 2026-06-17 10:20
Synced at: 2026-06-17 10:25
```

## 测试 4：普通在线订单不显示标签

1. 联网使用 `/cashier` 做一笔普通 CASH 订单。
2. 打开 `/records`。
3. 确认该在线订单不显示“离线补同步”标签。

## 测试 5：KHQR 订单不受影响

1. 联网使用 `/cashier` 走 KHQR 流程。
2. 打开 `/records`。
3. 确认 KHQR 支付方式显示正常。
4. KHQR 订单不应显示“离线补同步”标签，除非它确实来自离线同步。

## 测试 6：dashboard 未调整

本轮不修改 dashboard。

验证点：

- `/dashboard` 正常打开。
- 今日经营数据无页面报错。
- 不要求出现离线补同步提示。
- 不要求改变统计归属口径。

## 当前边界

- 不改 records 排序。
- 不改 dashboard。
- 不改 `/cashier` 同步逻辑。
- 不清理已同步本地订单。
- 不处理同步失败订单面板。
