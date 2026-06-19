# Desktop-Display-CurrentFastPath-01A Freeze

本文件为冻结记录，不替代原始开发记录和验收记录。

## 冻结结论

Desktop-Display-CurrentFastPath-01A 已完成并冻结。经生产双页面 trace，首件商品点击后状态序列为 `IDLE -> ORDER_ACTIVE`，没有 `ORDER_ACTIVE -> IDLE -> ORDER_ACTIVE`，没有 loading、reload 或 body 空白。

当前首件商品进入订单态耗时已从此前约 1.9-2.6 秒优化到约 1.3 秒。该阶段通过 `/api/pos/session/current` active-first fast path 和空闲态热销查询优化，降低首件商品进入订单态延迟。

当前仍采用 PosSession + 轮询方案。后续如追求主流 POS 级实时同屏，需要单独评估 SSE、本地双屏或桌面客户端方案。

## 冻结信息

- 冻结名称：Desktop-Display-CurrentFastPath-01A
- 冻结 commit：`0c75efb`
- 生产状态：Vercel Production READY

## 冻结内容

1. `/api/pos/session/current` 增加 active-first fast path。
2. 当前 PosSession 有 items / itemCount / totalAmount 时优先返回订单 payload。
3. active order 场景不再查询热销商品、空闲推荐或空闲态 KHQR 大图。
4. 空闲态热销商品查询增加短缓存。
5. 顾客屏 IDLE 轮播在 current fetch pending 时跳过本次切换，降低空闲态视觉闪动。
6. 首件商品进入订单态耗时由约 1.9-2.6 秒优化至约 1.3 秒。
7. 状态序列保持 `IDLE -> ORDER_ACTIVE`，无状态倒退。
8. 不改 API 结构。
9. 不改收银主链路。
10. Obsidian 已同步开发记录。

## 未改内容

1. 未改数据库。
2. 未新增 migration。
3. 未改 PosSession API 结构。
4. 未改 `/api/cashier/sales`。
5. 未改 `/cashier` 主收银逻辑。
6. 未改 KHQR 生成 / 回调 / 查单。
7. 未改离线收银。
8. 未改 records / dashboard。
9. 未引入 WebSocket / SSE。
10. 未引入动画库。
11. 未做本地双屏通道。

## 真实验收结果

1. 空购物车点击第一个商品后，顾客屏可进入订单态并显示金额。
2. 首件商品进入订单态速度较前一版明显改善。
3. 继续加商品、改数量稳定同步。
4. 切换 KHQR / CASH 正常显示和清除二维码。
5. 清空购物车、完成销售后正常回空闲态。
6. 在线 CASH / KHQR、离线 CASH 不受影响。

## 当前边界

本阶段只优化 current API active fast path 和空闲态视觉稳定性，不改变同步架构。PosSession + polling 仍是当前实现方式。

## 下一步建议

如后续继续追求更低延迟，应单独开启方案评估，不在本冻结范围内继续叠加小补丁：

- SSE 或轻量实时通道。
- 本地双屏同机通信方案。
- 桌面客户端 / kiosk 专用容器方案。
