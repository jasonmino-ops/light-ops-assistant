# Cashier Offline-03F Dashboard Test Guide

## 目标

验证 dashboard 已增加离线补同步轻提示，同时确认主统计口径没有在本轮被改动。

本阶段只验证：

- dashboard 可显示离线补同步提示。
- 普通在线 CASH / KHQR 不计入离线补同步提示。
- `/records` 仍正常显示离线补同步标签。

本阶段不验证：

- dashboard 按业务发生时间重算。
- 跨日补同步归属修正。
- 同步失败订单运营面板。

## 前置条件

- 生产版本已部署 Offline-03F-1。
- `/cashier` 已有商品缓存。
- `/cashier` Offline-03D 手动同步能力可用。
- `/records` Offline-03E-1 标签展示可用。

## 测试 1：创建并同步一笔离线 CASH 订单

1. 联网打开：

```text
/cashier?storeCode=ST169E7000
```

2. 确认商品缓存正常。
3. 断网。
4. 使用缓存商品创建一笔离线 CASH 订单。
5. 确认待同步数量增加。
6. 恢复网络。
7. 点击“同步离线订单”。
8. 确认 IndexedDB 中该订单变为 `SYNCED`，并写回 `serverSaleRecordId`。

## 测试 2：dashboard 离线补同步提示

1. 打开 `/dashboard`。
2. 选择与测试订单相同的日期范围。
3. 确认 dashboard 正常加载。
4. 确认经营概览附近显示：

```text
含离线补同步 X 笔，金额 $Y
```

英文界面应显示：

```text
Includes X offline-synced orders, $Y
```

## 测试 3：普通在线 CASH 不触发离线提示

1. 联网在 `/cashier` 做一笔普通 CASH 订单。
2. 打开 `/dashboard`。
3. 确认普通在线 CASH 不会单独增加离线补同步提示笔数。

## 测试 4：KHQR 不计入离线补同步提示

1. 联网做一笔 KHQR 订单。
2. 打开 `/dashboard`。
3. 确认 KHQR 不计入 `offlineSyncedSummary.count`。

## 测试 5：主统计口径未改

本轮不改变以下 dashboard 主统计：

- 今日销售额。
- 销售单数。
- 退款金额 / 退款单数。
- CASH 金额。
- KHQR 金额。
- H5 顾客订单金额。

如果离线补同步订单已经被当前 `SaleRecord.createdAt` 口径纳入当日统计，本轮只提示，不修正归属。

## 测试 6：records 回归

1. 打开 `/records`。
2. 找到刚同步的离线订单。
3. 确认仍显示“离线补同步”标签。
4. 确认仍显示离线销售时间和同步时间。
5. 确认普通在线 CASH / KHQR 不显示该标签。

## 当前边界

- 不改 dashboard 主统计口径。
- 不改 dashboard 日期归属。
- 不改 `/records`。
- 不改 `/cashier`。
- 不改 offline-sync API。
- 不改数据库。
