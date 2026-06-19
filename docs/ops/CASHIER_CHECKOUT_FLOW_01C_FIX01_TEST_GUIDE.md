# Cashier Checkout Flow 01C Fix01 Test Guide

本文件用于验证 desktop POS KHQR 二维码展示延迟修复，不替代真实验收记录。

## 1. 问题背景

01C 接入完成销售后，desktop 新收款面板点击“扫码收款 KHQR”只更新 `desktopSelectedPaymentMethod`。

原 `/cashier` KHQR 展示链路依赖原 `payment === 'KHQR'` 状态，再由既有 PosSession effect 写入顾客屏：

- `paymentMethod = KHQR`
- `paymentStatus = PENDING`
- `status = AWAITING_PAYMENT`
- `message = 请扫码支付`

因此 desktop 面板未同步原 `payment` 时，顾客屏二维码需要等到确认收款才触发，体验偏慢。

## 2. 修复范围

本轮只在 desktop payment 面板中同步原 payment 状态：

- 点击 CASH：设置 `desktopSelectedPaymentMethod = CASH`，同时 `setPayment('CASH')`。
- 点击 KHQR：设置 `desktopSelectedPaymentMethod = KHQR`，同时 `setPayment('KHQR')`。

不改：

- KHQR 生成逻辑
- KHQR 回调 / 查单
- `/api/cashier/sales`
- 数据库
- `/sale`
- offline-sync
- 顾客屏协议

## 3. Desktop POS KHQR 展示速度

打开：

```text
/desktop/pos?storeCode=ST169E7000&lang=zh
```

配合顾客屏：

```text
/desktop/display?storeCode=ST169E7000&lang=zh
```

步骤：

1. 选择商品。
2. 点击“确认本单”。
3. 点击“确认本单，选择收款方式”。
4. 点击“扫码收款 KHQR”。
5. 观察顾客屏是否快速显示 KHQR 二维码。

通过标准：

- 不需要等到“确认 KHQR 已收款，完成销售”才显示二维码。
- 顾客屏显示本单金额和扫码提示。
- 二维码不重复异常生成。

## 4. CASH 回归

步骤：

1. 在 payment 面板选择 KHQR，确认顾客屏显示 KHQR。
2. 切换选择 CASH。
3. 确认顾客屏清除本单 KHQR。
4. 点击“确认现金已收款，完成销售”仍能完成销售。

## 5. KHQR 完成销售回归

步骤：

1. 选择 KHQR。
2. 确认顾客屏二维码已出现。
3. 点击“确认 KHQR 已收款，完成销售”。
4. 确认仍复用原 `handleSubmit('KHQR')`。
5. 确认 `/records` 出现 KHQR 记录。

## 6. 非 desktop `/cashier` 回归

打开：

```text
/cashier?storeCode=ST169E7000&lang=zh
```

确认原 CASH / KHQR 选择和完成销售流程不受影响。

## 7. `/sale` 回归

打开：

```text
/sale
```

确认页面正常，不受本补丁影响。
