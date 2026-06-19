# Cashier Checkout Flow 01C Design

本文件为电脑端 POS CASH / KHQR 完成销售闭环设计归档，不替代原始开发记录。

## 1. 前置状态

Cashier-CheckoutFlow-01A / 01B 已完成：

- `/desktop/pos` 继续完全复用 `/cashier`。
- `isDesktopPos === true` 是保护开关。
- 非 desktop `/cashier` 原流程保持不变。
- 01A 已实现“确认本单”与本单确认视图。
- 01B 已实现 CASH / KHQR 选择收款方式面板。
- 01B 点击 CASH / KHQR 只显示选中状态，不创建 SaleRecord。

## 2. 本轮目标

Cashier-CheckoutFlow-01C 的目标是让 desktop-only 新流程最后一步复用现有 `/cashier` 完成销售能力：

1. 选择商品。
2. 确认本单。
3. 选择 CASH 或 KHQR。
4. 店员确认已收款。
5. 复用现有 `handleSubmit()` 调用链。
6. 创建 SaleRecord。
7. 清空购物车。
8. 顾客屏进入既有完成态。
9. `/records` 可看到销售记录。

本轮不是重新写一套 desktop POS 提交链路。

## 3. 现有完成销售调用链取证

`app/cashier/page.tsx` 原非 desktop `/cashier` 的“完成销售”按钮调用：

```tsx
onClick={handleSubmit}
```

`handleSubmit()` 现有职责：

- 检查购物车、提交中状态和 `storeCode`。
- 读取当前 `payment` 状态。
- `MEMBER_BALANCE` 分支打开会员余额支付弹层。
- 离线状态下只允许 CASH，并复用 IndexedDB 离线订单保存能力。
- 在线状态下调用唯一的 `POST /api/cashier/sales`。
- 成功后写顾客屏 `COMPLETED` PosSession 镜像。
- 成功后清空购物车。
- 成功后将支付方式重置为 CASH。
- 成功后展示销售成功结果弹层。
- 使用 `submitting` 做前端重复点击保护。
- 失败时保留购物车并显示错误。

## 4. 本轮复用方式

本轮对 `handleSubmit()` 做最小签名扩展：

```ts
handleSubmit(paymentOverride?: CashierPaymentMethod)
```

原则：

- 原非 desktop 调用 `handleSubmit` 不传参数，行为不变。
- desktop payment 面板点击确认收款时，将 `desktopSelectedPaymentMethod` 作为 override 传入。
- `handleSubmit()` 内部仍使用同一个函数体、同一个 `/api/cashier/sales` fetch、同一套离线 CASH 保存和成功清理逻辑。
- 不新增提交函数。
- 不新增新的 `fetch('/api/cashier/sales')`。
- 不复制提交逻辑。

## 5. desktop payment method 映射

`desktopSelectedPaymentMethod` 只允许：

- `CASH`
- `KHQR`

点击确认收款时：

- 同步设置原 `payment` 状态，便于 UI 和后续状态保持一致。
- 调用 `handleSubmit(desktopSelectedPaymentMethod)`。

这样避免 React `setPayment()` 异步导致 `handleSubmit()` 读取旧支付方式。

## 6. CASH 处理边界

CASH 流程：

1. 店员选择 CASH。
2. 点击“确认现金已收款，完成销售”。
3. 复用 `handleSubmit('CASH')`。
4. 在线时调用原 `/api/cashier/sales`。
5. 离线时复用原 IndexedDB 离线 CASH 保存能力。
6. 成功后复用原清空购物车、顾客屏完成态、成功弹层。

本轮不新增现金 API，不新增数据库字段。

## 7. KHQR 处理边界

KHQR 流程：

1. 店员选择 KHQR。
2. 点击“确认 KHQR 已收款，完成销售”。
3. 复用 `handleSubmit('KHQR')`。
4. 在线时调用原 `/api/cashier/sales`。
5. 成功后复用原清空购物车、顾客屏完成态、成功弹层。

本轮继续采用人工确认已收款模式：

- 不新增 KHQR 支付单。
- 不接自动回调。
- 不查单。
- 不改二维码生成逻辑。

## 8. 顾客屏完成态边界

本轮不改 PosSession API。

成功后仍由原 `handleSubmit()` 写入：

- `status: COMPLETED`
- `paymentStatus: PAID`
- 当前订单 items
- `orderNo`

顾客屏 `/desktop/display` 按既有逻辑展示完成态或感谢页。

## 9. 重复点击保护

复用原 `submitting` 状态：

- 点击确认收款后按钮 disabled。
- 请求未结束前不能重复提交。
- 成功后购物车清空，无法再次提交同一购物车。
- 失败时 `submitting` 复位，购物车保留，可重试或返回修改。

本轮不新增后端幂等机制。

## 10. 失败保留购物车

沿用原 `handleSubmit()` 失败策略：

- 在线 API 失败时保留购物车。
- 网络异常时保留购物车。
- 离线保存失败时保留购物车。
- 错误信息显示在 payment 面板。
- desktop 选择的收款方式尽量保留。

## 11. 不改内容

本轮不改：

- 数据库 schema。
- Prisma migration。
- `/api/cashier/sales`。
- `/api/cashier/offline-sync`。
- records / dashboard 统计口径。
- KHQR 回调 / 查单。
- PosSession API 结构。
- `/sale/page.tsx`。
- 小票打印。
- 会员积分 / 优惠券 / 库存新逻辑。

## 12. 后续不在本轮做

- 小票打印。
- 找零面板。
- KHQR 等待扫码专用面板。
- 后端幂等 key。
- 退款。
- 日结 / 交班。
