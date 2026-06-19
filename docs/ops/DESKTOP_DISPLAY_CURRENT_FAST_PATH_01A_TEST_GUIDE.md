# Desktop-Display-CurrentFastPath-01A Test Guide

本指南用于验证顾客屏首件商品从空闲态进入订单态的速度和视觉稳定性。

## 范围

- 只验证 `/desktop/display` 与 `/api/pos/session/current` 的 active fast path。
- 不验证自动付款、KHQR 回调、查单、离线同步或 records/dashboard。
- 不创建数据库 migration。

## 准备

1. 打开顾客屏：
   `/desktop/display?storeCode=ST169E7000`
2. 打开员工端：
   `/cashier?storeCode=ST169E7000`
3. 确保购物车为空，顾客屏处于空闲态。
4. 打开浏览器 Network 面板，过滤：
   - `/api/cashier/display-session`
   - `/api/pos/session/current`

## 验证首件商品

1. 在 `/cashier` 从空购物车点击第一个商品。
2. 确认 `/api/cashier/display-session` 只发起一次 active cart 写入。
3. 确认 payload 包含：
   - `status=DRAFT`
   - `paymentMethod=CASH`
   - `items.length=1`
   - `totalAmount > 0`
4. 确认 `/api/pos/session/current` 第一次返回 active order 时包含：
   - `session.status=DRAFT`
   - `session.items.length > 0`
   - `session.itemCount > 0`
   - `session.totalAmount > 0`
5. 观察顾客屏是否快速从空闲态进入订单态，不再明显闪欢迎页。

## 验证 current fast path

active order 存在时，`/api/pos/session/current` 不应再执行空闲态热销/推荐展示逻辑。

Network 观察目标：

- active current 响应中 `displayProducts` 为空数组。
- active current 响应不返回空闲态常驻大 KHQR。
- active current 响应只包含当前订单所需数据。

## 验证空闲态轮播防闪

1. 顾客屏回到空闲态。
2. 观察本周热销轮播。
3. 在 `/api/pos/session/current` 请求 pending 时，轮播不应刚好切换造成明显闪白。
4. 轮播功能仍应正常：无订单时继续按间隔切换。

## 回归验证

必须确认：

1. 继续加商品后，顾客屏商品和金额同步。
2. 修改数量后，金额同步。
3. 选择 KHQR 后，顾客屏显示二维码。
4. 切回 CASH 后，二维码清除。
5. 清空购物车后，顾客屏回空闲态。
6. 完成销售后，约 2.5 秒回空闲态。
7. 在线 CASH / KHQR 不受影响。
8. 离线 CASH 不受影响。

## 当前边界

- 不改 PosSession 数据结构。
- 不改 `/cashier` 主收银逻辑。
- 不改 KHQR 回调或查单。
- 不引入 WebSocket / SSE。
- 不引入动画库。
