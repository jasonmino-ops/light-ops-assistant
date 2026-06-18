# Cashier-Web-PosSession-Sync-01A 冻结记录

## 冻结结论

Cashier-Web-PosSession-Sync-01A 已完成并冻结。

电脑端 `/cashier` 的购物车、金额、支付方式和 KHQR 状态已可通过 PosSession 同步到顾客屏 `/desktop/display`。已修复生产环境中 debounce 写入误判、接口缓存和顾客屏 current API 负载过重导致的同步延迟问题。

双屏场景下，员工端加商品、改数量、清空购物车、选择 KHQR、切回 CASH、完成销售后，顾客屏可正确同步且不保留旧订单或旧二维码。

## 冻结 commit

`a1c2244`

## 冻结内容

1. `/cashier` 购物车变化写入 PosSession
2. `/cashier` 支付方式变化写入 PosSession
3. `/cashier` 仅在真正发起写入时记录 syncKey，避免误判已同步
4. `/api/cashier/display-session` 增加 `no-store`
5. `/api/pos/session/current` 增加 `no-store`
6. `/api/pos/session/current` 在有当前订单时跳过空闲推荐查询，减轻轮询负载
7. `/api/pos/session/current` 避免 CASH 当前单返回常驻 KHQR 大图
8. `/desktop/display` 读取 current session 后同步显示商品、金额、支付方式和 KHQR
9. 切回 CASH 后顾客屏清除 KHQR
10. 清空购物车或完成销售后顾客屏不保留旧订单
11. 更新双屏同步测试说明文档
12. Obsidian 已同步开发记录

## 未改内容

1. 未改数据库
2. 未新增 migration
3. 未改 `/api/cashier/sales`
4. 未改 SaleRecord
5. 未改 PaymentIntent
6. 未改 KHQR 回调/查单
7. 未改 offline-sync API
8. 未改离线收银保存/同步逻辑
9. 未改 `/records`
10. 未改 `/dashboard`
11. 未引入 WebSocket / SSE
12. 未做自动确认付款

## 真实验收结果

1. 电脑 A 打开 `/cashier?storeCode=ST169E7000` 正常
2. 电脑 B 打开 `/desktop/display?storeCode=ST169E7000` 正常
3. 员工端加商品后，顾客屏可显示商品和金额
4. 修改数量后，顾客屏金额同步
5. 删除/清空购物车后，顾客屏清空
6. 选择 KHQR 后，顾客屏显示二维码和金额
7. 切回 CASH 后，顾客屏清除 KHQR
8. 完成销售后，顾客屏不保留旧商品或旧二维码
9. 在线 CASH / KHQR 不受影响
10. 离线 CASH 不受影响

## 当前边界

本阶段只做电脑端 `/cashier` 到顾客屏 `/desktop/display` 的 PosSession 镜像同步能力。

不做 KHQR 自动回调，不做自动到账确认，不做 WebSocket / SSE，不改收银主链路，不改离线收银链路。

## 后续建议

1. 保持当前轮询 + debounce 方案作为 V1 稳定方案。
2. 如果后续双屏体验需要进一步接近实时，再单独评估 WebSocket / SSE，不应混入当前冻结链路。
3. 后续任何 KHQR 自动到账、查单或状态机改动，应作为独立支付任务处理。
