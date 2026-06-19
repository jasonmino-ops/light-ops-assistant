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

## RootCause Trace 01A 补充结论

线上帧级取证发现，首件商品点击后员工端写入并不慢：

- `/api/cashier/display-session` 在点击后约 36-56ms 已写入 `DRAFT + CASH + 1 item + totalAmount=0.50`。
- 顾客屏 DOM 没有出现 `ORDER_ACTIVE → IDLE → ORDER_ACTIVE`；真实序列是长时间保持 `IDLE`，随后才进入 `ORDER_ACTIVE`。
- 线上 `/api/pos/session/current` 在 idle 状态下可能存在较慢响应；若顾客屏因为已有 current 请求在飞而跳过后续轮询，会导致 active session 迟到数秒。
- 进一步取证发现，如果移除轮询防重叠，多个 idle current 请求会并发堆积，反而拖慢首件商品的 `display-session` 写入。
- 最小修复采用两点：保留 current 轮询防重叠，并对 idle 热销商品查询做 60 秒服务端短缓存，避免空闲态每 800ms 重复执行热销聚合和商品图查询。

本轮修复后，应重点确认：

1. 点击首件商品后，顾客屏不再因为慢 idle current 请求而等待数秒。
2. 即使存在旧 idle/CANCELLED current 响应晚回来，也不会覆盖更新后的 active order。
3. Network 中不应出现大量 current 并发堆积。
4. idle current 响应应受短缓存保护，不再每轮重复跑热销聚合。

## 前端渲染状态检查

点击第一个商品后的 0-3 秒内，重点观察顾客屏渲染状态：

1. active order 到达前，可以继续保持原空闲态。
2. 一旦显示 `当前订单` / 商品 / 金额后，不应再回到 `欢迎光临` / `准备结账`。
3. `DRAFT + CASH + items.length > 0` 必须视为订单态。
4. `items.length > 0`、`itemCount > 0` 或 `totalAmount > 0` 任一成立时，不应渲染 IdleCard。
5. 点击前已在途的旧空态/取消态响应，不应触发 IdleCard 重渲染覆盖 active order。

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
