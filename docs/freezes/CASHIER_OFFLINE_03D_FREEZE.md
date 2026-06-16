# Cashier-Offline-03D 冻结记录

## 冻结结论

Cashier-Offline-03D 已完成并冻结。`/cashier` 已支持手动同步离线订单：断网时创建的 IndexedDB 离线 CASH 订单，在恢复网络后可由店员手动上传到 `POST /api/cashier/offline-sync`。

同步成功后，本地订单标记为 `SYNCED`，并写回 `serverSaleRecordId`；服务端生成正式 `SaleRecord`。当前仍不做自动同步，不改 `/records` 标签展示，不改 dashboard 统计口径。

## 冻结 commit

`61a2146`

## 冻结内容

1. `/cashier` 新增“同步离线订单”手动入口。
2. 只同步 `syncStatus = PENDING / FAILED` 的离线订单。
3. 单次最多同步 20 笔。
4. 同步中防重复点击。
5. 调用 `POST /api/cashier/offline-sync`。
6. `SYNCED` 订单写回 `serverSaleRecordId / syncedAt`。
7. `DUPLICATE` 订单也标记为 `SYNCED`，避免重复入账。
8. `FAILED` 订单保留在 IndexedDB，并记录错误原因。
9. 恢复网络后不自动同步，只提示手动同步。
10. 已同步订单不删除，待后续清理能力。
11. 新增 Offline-03D 测试说明文档。
12. Obsidian 已同步开发记录。

## 未改内容

1. 未改数据库。
2. 未新增 migration。
3. 未改在线 CASH / KHQR 主流程。
4. 未改 `/records` 展示标签。
5. 未改 dashboard 统计口径。
6. 未改 KHQR / AI / 优惠券 / 会员 / 退款逻辑。
7. 未做自动同步。
8. 未删除本地已同步订单。

## 真实验收结果

1. 联网打开 `/cashier?storeCode=ST169E7000` 商品缓存正常。
2. 断网可创建一笔离线 CASH 订单。
3. 待同步数量增加。
4. 恢复网络后不会自动同步。
5. 点击“同步离线订单”后订单变为 `SYNCED`。
6. IndexedDB 写回 `serverSaleRecordId`。
7. `/records` 可看到同步后的正式销售记录。
8. 同一 `offlineOrderId` 不重复生成 `SaleRecord`。
9. 在线 CASH / KHQR 仍正常。
10. PWA 桌面启动恢复 `storeCode` 正常。

## 当前边界

1. 不做自动同步。
2. 不删除已同步本地订单。
3. 不实现 `/records` “离线补同步”标签。
4. 不调整 dashboard 统计口径。
5. 不做离线 KHQR / AI / 优惠券 / 会员 / 退款。

## 下一步建议

进入 Offline-03E 规划：在 `/records` 展示“离线补同步”标签，并区分销售发生时间与同步时间。不要直接开发自动同步或清理已同步订单能力。
