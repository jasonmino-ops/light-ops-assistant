# Cashier Checkout Flow 01C Fix02 Test Guide

本文件用于验证 desktop POS 选择 KHQR 后 PosSession 是否立即切到 KHQR，不替代真实验收记录。

## 1. 问题背景

Fix01 已在 desktop payment 面板点击 KHQR 时同步原 `payment = KHQR`。

线上验证仍发现：员工端显示“当前已选择：扫码收款 KHQR”，但顾客屏仍显示“收款方式：现金”，说明顾客屏读取到的 PosSession 仍是 CASH。

## 2. 字段取证

顾客屏 `/desktop/display` 判断支付方式依赖：

- `session.paymentMethod`

顾客屏显示 KHQR 二维码需要：

- `session.paymentMethod = KHQR`
- `session.khqrImageUrl` 或 `session.khqrPayload`
- 当前 session 有商品或金额

原 `/cashier` KHQR 展示链路：

- `payment === KHQR`
- PosSession mirror effect 写入 `/api/cashier/display-session`
- payload 包含 `status=AWAITING_PAYMENT`、`paymentMethod=KHQR`、`paymentStatus=PENDING`
- `/api/cashier/display-session` 复用门店 KHQR 配置生成 `khqrImageUrl / khqrPayload`

## 3. Fix02 修复范围

Fix02 在 desktop payment 面板点击 CASH / KHQR 时，除同步 UI 和原 `payment` 状态外，立即复用当前购物车字段写入 PosSession：

- CASH：`status=DRAFT`，`paymentMethod=CASH`
- KHQR：`status=AWAITING_PAYMENT`，`paymentMethod=KHQR`，`paymentStatus=PENDING`

不改：

- `/api/cashier/display-session` 结构
- `/api/pos/session/current`
- `/api/cashier/sales`
- KHQR 生成、回调、查单
- 数据库
- `/sale`
- offline-sync

## 4. Desktop POS 选择 KHQR

同时打开：

```text
/desktop/pos?storeCode=ST169E7000&lang=zh
/desktop/display?storeCode=ST169E7000&lang=zh
```

步骤：

1. 选商品。
2. 点击“确认本单”。
3. 点击“确认本单，选择收款方式”。
4. 点击“扫码收款 KHQR”。

通过标准：

- 收银台显示当前选择 KHQR。
- 顾客屏收款方式显示 KHQR / 扫码支付。
- 顾客屏快速出现二维码。
- 顾客屏金额与收银台一致。
- 不需要点击“确认 KHQR 已收款，完成销售”。

## 5. KHQR 切回 CASH

步骤：

1. 在 payment 面板先点 KHQR。
2. 确认顾客屏出现 KHQR 二维码。
3. 再点 CASH。

通过标准：

- 顾客屏不再显示 KHQR 二维码。
- 顾客屏收款方式切回 CASH / 现金。
- 商品和金额不丢。

## 6. 完成销售回归

KHQR：

1. 选择 KHQR。
2. 顾客屏出现二维码。
3. 点击“确认 KHQR 已收款，完成销售”。
4. 确认创建 KHQR 记录。
5. 顾客屏进入完成态。

CASH：

1. 选择 CASH。
2. 点击“确认现金已收款，完成销售”。
3. 确认创建 CASH 记录。
4. 顾客屏进入完成态。

## 7. 非 desktop 回归

打开：

```text
/cashier?storeCode=ST169E7000&lang=zh
```

确认原 CASH / KHQR 流程不变。

打开：

```text
/sale
```

确认页面不受影响。
