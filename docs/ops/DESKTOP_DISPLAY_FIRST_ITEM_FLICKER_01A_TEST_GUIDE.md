# Desktop Display First Item Flicker 01A Test Guide

本说明用于验证员工端 `/cashier` 从空购物车加入第一个商品时，顾客屏 `/desktop/display` 不再短暂闪回欢迎页。

本补丁只调整首次建单时 PosSession 写入时机，不改 PosSession API、不改数据库、不改 KHQR 逻辑、不改 `/cashier` 主收银链路。

## 测试页面

- 员工端：`/cashier?storeCode=ST169E7000`
- 顾客屏：`/desktop/display?storeCode=ST169E7000`

建议使用两台电脑，或同一电脑的两个不同浏览器窗口。

## 首件商品测试

1. 确认员工端购物车为空。
2. 确认顾客屏处于欢迎页 / 空闲态。
3. 在员工端点击任意商品加入购物车。
4. 观察顾客屏是否直接进入订单态，或在 0.5-1.5 秒内稳定显示商品和金额。
5. 顾客屏不应先闪回欢迎页再显示订单。

## 请求时序检查

使用 Browser / Playwright 或 DevTools Network 观察点击后 0-2 秒：

1. `/api/cashier/display-session` 应只出现一次有效 active 写入。
2. active 写入的 `items.length` 应大于 0，`status` 应为 `DRAFT` 或 `AWAITING_PAYMENT`。
3. 首件商品点击后不应再出现空 `items` 的 `CANCELLED` 写入。
4. `/api/pos/session/current` 如果返回点击前已在途的旧空态响应，顾客屏不应在已显示 active order 后被旧空态覆盖。
5. 后续轮询应稳定返回当前商品和金额。

## 后续同步测试

1. 在员工端继续添加第二个商品。
2. 确认顾客屏商品和金额正常更新。
3. 修改商品数量。
4. 确认顾客屏数量和金额正常更新。
5. 删除一个商品。
6. 确认顾客屏同步删除结果。

## 支付方式测试

1. 在员工端选择 KHQR。
2. 确认顾客屏显示本单 KHQR 二维码和金额。
3. 切回 CASH。
4. 确认顾客屏清除本单 KHQR。

## 清空与完成测试

1. 点击员工端清空购物车。
2. 确认顾客屏清空当前订单，不保留旧商品或旧二维码。
3. 重新添加商品并完成一笔测试销售。
4. 确认顾客屏短暂显示完成态后回到欢迎页。

## 回归边界

必须确认：

- 在线 CASH 收银不受影响。
- 在线 KHQR 收银不受影响。
- 离线 CASH 收银不受影响。
- 顾客屏 polling 间隔没有改变。
- 本补丁没有新增 API、migration、WebSocket/SSE 或动画库。
