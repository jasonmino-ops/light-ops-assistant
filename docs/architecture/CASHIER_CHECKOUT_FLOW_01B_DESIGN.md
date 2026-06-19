# Cashier Checkout Flow 01B Design

本文件为电脑端 POS 选择收款方式面板设计归档，不替代原始开发记录。

## 1. 前置状态

Cashier-CheckoutFlow-01A / 01C 已完成：

- `/desktop/pos` 继续复用 `/cashier`。
- `isDesktopPos === true` 作为电脑端 POS 流程保护开关。
- 电脑端商品选择阶段底部主按钮改为“确认本单”。
- 点击“确认本单”只进入本单确认视图。
- 点击“确认本单，选择收款方式”进入 `SELECT_PAYMENT` 占位。
- 未调用 `handleSubmit()`。
- 未创建 SaleRecord。
- 未改数据库、API、离线收银、顾客屏同步或 `/sale`。

## 2. 本轮目标

Cashier-CheckoutFlow-01B 只把 01A 的 `SELECT_PAYMENT` 占位替换为真正的选择收款方式面板。

目标流程：

1. 选择商品 / 扫码。
2. 点击“确认本单”。
3. 进入本单确认。
4. 点击“确认本单，选择收款方式”。
5. 进入选择收款方式面板。
6. 可选择 CASH 或 KHQR。
7. 本轮到此为止。

本轮仍不完成销售。

## 3. desktop-only 保护

新面板只在以下条件启用：

```ts
isDesktopPos === true && checkoutStep === 'SELECT_PAYMENT'
```

非 desktop `/cashier` 继续显示原收款方式按钮和“完成销售”按钮，继续走原 `handleSubmit()`。

## 4. 状态设计

现有 desktop checkout 状态保持：

- `SELECT_ITEMS`：商品选择 / 购物车阶段。
- `CONFIRM_ORDER`：本单确认阶段。
- `SELECT_PAYMENT`：选择收款方式阶段。

本轮新增独立 UI 选中状态：

```ts
desktopSelectedPaymentMethod: 'CASH' | 'KHQR' | null
```

该状态只用于电脑端支付面板显示，不复用原全局 `payment` 状态，避免误触发现有 CASH / KHQR 提交流程或顾客屏 KHQR 状态。

## 5. CASH / KHQR 行为

### CASH

点击“现金收款 CASH”：

- 设置 `desktopSelectedPaymentMethod = 'CASH'`。
- 显示当前已选择 CASH。
- 不调用 `handleSubmit()`。
- 不创建 SaleRecord。
- 不写 PaymentIntent。
- 不清空购物车。

### KHQR

点击“扫码收款 KHQR”：

- 设置 `desktopSelectedPaymentMethod = 'KHQR'`。
- 显示当前已选择 KHQR。
- 不调用 `handleSubmit()`。
- 不创建 SaleRecord。
- 不生成新的 KHQR 支付单。
- 不改 KHQR 回调 / 查单。
- 不主动改变顾客屏协议。

## 6. 返回逻辑

选择收款方式面板提供：

- “返回本单确认”：回到 `CONFIRM_ORDER`。
- “返回修改商品”：回到 `SELECT_ITEMS`。

返回时：

- 购物车不丢。
- 商品数量不丢。
- 金额不丢。
- 不调用提交 API。

购物车被清空时：

- `checkoutStep` 回到 `SELECT_ITEMS`。
- `desktopSelectedPaymentMethod` 清空。

## 7. 顾客屏边界

本轮不改 PosSession 同步逻辑。

- 员工端选商品时，顾客屏仍按当前 PosSession 显示商品和金额。
- 进入本单确认不额外改变顾客屏状态。
- 进入选择收款方式不清空顾客屏。
- 点击 CASH / KHQR 只影响员工端面板选中态，不主动触发顾客屏支付态。
- 不进入顾客屏感谢页。

## 8. 明确不做

本轮不做：

- CASH 完成销售。
- KHQR 完成销售。
- 找零。
- KHQR 等待扫码面板。
- SaleRecord 创建。
- PaymentIntent 创建。
- `handleSubmit()` 修改或调用。
- `/api/cashier/sales` 修改。
- `/api/cashier/offline-sync` 修改。
- 数据库 schema / migration。
- records / dashboard 统计调整。
- `/sale/page.tsx` 修改。

## 9. 后续阶段

后续建议：

- 01C：CASH / KHQR 完成销售闭环设计与小步接入。
- 01D：CASH 收款确认和可选找零。
- 01E：KHQR 等待扫码面板和人工确认。
- 01F：真实门店试跑与冻结。

任何需要修改 `handleSubmit()`、`/api/cashier/sales`、SaleRecord / PaymentIntent、PosSession API、离线订单结构或 KHQR 状态机的任务，都应暂停并回 Claude 复审。
