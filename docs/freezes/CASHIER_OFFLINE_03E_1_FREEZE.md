# Cashier-Offline-03E-1 冻结记录

## 冻结结论

Cashier-Offline-03E-1 已完成并冻结。`/records` 已支持识别离线补同步订单，并在记录卡片中展示“离线补同步”标签、离线销售时间和同步时间。

普通在线 CASH 订单和 KHQR 订单不显示该标签，dashboard 本轮未改动。

## 冻结 commit

`997491d`

## 冻结内容

1. `/records` API 返回离线补同步相关字段。
2. `/records` 页面识别 `offlineOrderId` 或 `source = CASHIER_OFFLINE` 的订单。
3. 离线补同步订单显示“离线补同步”标签。
4. 离线补同步订单显示离线销售时间。
5. 离线补同步订单显示同步时间。
6. i18n 已补充 zh / en / km 文案。
7. 更新 Offline-03E 规划文档。
8. 新增 Offline-03E records 测试说明文档。
9. Obsidian 已同步开发记录。

## 未改内容

1. 未改数据库。
2. 未新增 migration。
3. 未改 `/cashier` 离线同步逻辑。
4. 未改 offline-sync API。
5. 未改 records 排序。
6. 未改 dashboard 统计口径。
7. 未改在线 CASH / KHQR 主流程。
8. 未改 AI / 优惠券 / 会员 / 退款逻辑。

## 真实验收结果

1. `/records` 正常打开。
2. 离线同步订单显示“离线补同步”标签。
3. 离线同步订单显示离线销售时间和同步时间。
4. 普通在线 CASH 订单不显示离线补同步标签。
5. KHQR 订单显示不受影响。
6. dashboard 正常打开，本轮未新增离线统计展示。
7. `/cashier` 离线收银与手动同步仍正常。
8. PWA 桌面启动恢复 `storeCode` 正常。

## 当前边界

1. 不做 dashboard 离线补同步统计。
2. 不改 records 排序。
3. 不做同步失败订单面板。
4. 不做已同步本地订单清理。
5. 不做库存异常处理界面。

## 下一步建议

进入 Offline-03F 规划：dashboard 离线补同步提示与统计口径。建议先规划，不直接实现统计口径调整。
