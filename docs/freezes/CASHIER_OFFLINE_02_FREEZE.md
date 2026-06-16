# Cashier-Offline-02 冻结记录

## 冻结结论

Cashier-Offline-02 已完成并冻结。`/cashier` 在断网且已有商品缓存时，可进入离线收银模式，允许使用缓存商品完成最小 CASH 收银，并将离线订单保存到 IndexedDB。本阶段只做本地保存，不做自动同步，不进入 `/records`，不改数据库。

## 冻结信息

- 冻结名称：Cashier-Offline-02
- 冻结 commit：`5b4bddf`
- 冻结日期：2026-06-17

## 冻结内容

1. IndexedDB 增加 `cashier_offline_orders` 本地离线订单存储。
2. 断网时可使用已缓存商品进行离线收银。
3. 离线模式下只允许 CASH。
4. 离线模式下禁止 KHQR。
5. 离线 CASH 完成后生成 `offlineOrderId`。
6. 离线订单写入 IndexedDB。
7. 页面显示待同步离线订单数量。
8. 恢复网络后只提示待同步，不自动上传。
9. 新增 Offline-02 测试说明文档。
10. Obsidian 已同步开发记录。

## 未改内容

1. 未改数据库。
2. 未新增 Prisma migration。
3. 未新增 `/api/cashier/offline-sync`。
4. 未自动同步离线订单。
5. 未让离线订单进入 `/records`。
6. 未改 dashboard 统计口径。
7. 未改在线 CASH / KHQR / records 主流程。
8. 未改优惠券 / 会员 / 退款逻辑。

## 真实验收结果

1. 联网打开 `/cashier?storeCode=ST169E7000` 后商品缓存正常。
2. 断网后页面进入离线收银模式。
3. 有缓存商品时可加入购物车。
4. 离线时 KHQR 被禁用，只允许 CASH。
5. 离线 CASH 完成后订单保存到 IndexedDB。
6. 待同步订单数量增加。
7. 离线订单不会出现在 `/records`。
8. 恢复网络后不会自动同步。
9. 恢复网络后在线 CASH / KHQR 仍正常。
10. PWA 桌面启动恢复 storeCode 正常。

## 当前边界

- 当前只完成离线 CASH 本地记账。
- 当前不做自动同步。
- 当前不生成线上 SaleRecord。
- 当前不进入 `/records`。
- 当前不改数据库。

## 下一步建议

进入 Offline-03 前，先单独设计并验收服务端同步接口、幂等策略和异常订单处理方式。Offline-03 才应实现 `/api/cashier/offline-sync` 与恢复网络后的同步流程。
