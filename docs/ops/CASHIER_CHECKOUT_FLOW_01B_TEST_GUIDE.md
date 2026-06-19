# Cashier Checkout Flow 01B Test Guide

本文件为电脑端 POS 选择收款方式面板测试说明，不替代真实验收记录。

## 1. 测试范围

本轮只验证 `/desktop/pos` 的 desktop-only 选择收款方式面板。

不验证：

- CASH 完成销售。
- KHQR 完成销售。
- SaleRecord 创建。
- KHQR 回调 / 查单。
- 离线订单同步。

## 2. Desktop POS 路径

打开：

```text
/desktop/pos?storeCode=ST169E7000&lang=zh
```

步骤：

1. 选择一个商品加入购物车。
2. 点击“确认本单”。
3. 确认进入本单确认视图。
4. 点击“确认本单，选择收款方式”。
5. 确认进入“选择收款方式”面板。
6. 确认可见：
   - 现金收款 CASH
   - 扫码收款 KHQR
   - 返回本单确认
   - 返回修改商品
7. 点击 CASH。
8. 确认只显示 CASH 选中状态，不创建销售记录。
9. 点击 KHQR。
10. 确认只显示 KHQR 选中状态，不创建销售记录。

## 3. 返回逻辑

在选择收款方式面板：

1. 点击“返回本单确认”。
2. 确认回到本单确认视图。
3. 确认商品、数量、金额不丢。
4. 再进入选择收款方式。
5. 点击“返回修改商品”。
6. 确认回到商品选择 / 购物车视图。
7. 确认商品、数量、金额不丢。

## 4. 不应发生

点击“确认本单”、CASH、KHQR 时不应发生：

- 调用 `/api/cashier/sales`。
- 创建 SaleRecord。
- 清空购物车。
- 跳感谢页。
- 清空 PosSession。
- 改变手机端 `/cashier` 原流程。

## 5. 非 desktop `/cashier` 回归

打开：

```text
/cashier?storeCode=ST169E7000&lang=zh
```

确认：

1. 原收款方式按钮仍存在。
2. 原“完成销售”按钮仍存在。
3. 原 CASH / KHQR 流程保持不变。
4. 原离线 CASH 流程保持不变。

## 6. `/sale` 回归

打开：

```text
/sale
```

确认页面可正常加载，扫码 / 选商品、CASH、KHQR 不受本轮改动影响。

## 7. 顾客屏回归

打开：

```text
/desktop/display?storeCode=ST169E7000&lang=zh
```

配合 `/desktop/pos` 操作确认：

1. 商品加入后顾客屏仍显示本单。
2. 进入本单确认后顾客屏不被清空。
3. 进入选择收款方式后顾客屏不被清空。
4. 点击 CASH / KHQR 只影响员工端面板，不提前进入感谢页。
