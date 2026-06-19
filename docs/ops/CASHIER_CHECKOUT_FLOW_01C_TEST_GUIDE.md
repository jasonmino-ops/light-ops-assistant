# Cashier Checkout Flow 01C Test Guide

本文件为电脑端 POS CASH / KHQR 完成销售闭环测试说明，不替代真实验收记录。

## 1. Desktop POS CASH 完成销售

打开：

```text
/desktop/pos?storeCode=ST169E7000&lang=zh
```

步骤：

1. 选择商品加入购物车。
2. 点击“确认本单”。
3. 点击“确认本单，选择收款方式”。
4. 选择“现金收款 CASH”。
5. 点击“确认现金已收款，完成销售”。
6. 确认只创建一条销售记录。
7. 确认记录 paymentMethod 为 CASH 或系统现有 CASH 对应值。
8. 确认购物车清空。
9. 确认顾客屏进入完成态 / 感谢页。
10. 确认 `/records` 可看到该销售记录。

## 2. Desktop POS KHQR 完成销售

打开：

```text
/desktop/pos?storeCode=ST169E7000&lang=zh
```

步骤：

1. 选择商品加入购物车。
2. 点击“确认本单”。
3. 点击“确认本单，选择收款方式”。
4. 选择“扫码收款 KHQR”。
5. 点击“确认 KHQR 已收款，完成销售”。
6. 确认只创建一条销售记录。
7. 确认记录 paymentMethod 为 KHQR 或系统现有 KHQR 对应值。
8. 确认购物车清空。
9. 确认顾客屏进入完成态 / 感谢页。
10. 确认 `/records` 可看到该销售记录。

## 3. 重复点击保护

步骤：

1. 选择商品。
2. 进入选择收款方式面板。
3. 选择 CASH 或 KHQR。
4. 连续快速点击“确认收款，完成销售”按钮。
5. 确认按钮 loading / disabled。
6. 确认只创建一条销售记录。
7. 确认没有重复记录。

## 4. 失败保留购物车

可通过断网或模拟接口失败验证：

1. 提交失败后，购物车仍保留。
2. 商品数量和金额不丢。
3. 选择的收款方式尽量保留。
4. 可以重新提交。
5. 可以返回本单确认或返回修改商品。

## 5. 非 desktop `/cashier` 回归

打开：

```text
/cashier?storeCode=ST169E7000&lang=zh
```

确认：

1. 原收款方式按钮仍存在。
2. 原“完成销售”行为保持不变。
3. 原 CASH / KHQR 流程保持不变。
4. 原离线 CASH 流程保持不变。

## 6. `/sale` 回归

打开：

```text
/sale
```

确认：

1. 页面正常加载。
2. 扫码 / 选商品不受影响。
3. CASH 收款不受影响。
4. KHQR 不受影响。

## 7. 顾客屏完成态

打开：

```text
/desktop/display?storeCode=ST169E7000&lang=zh
```

配合 `/desktop/pos` 操作：

1. 商品加入后顾客屏显示本单。
2. 进入本单确认后顾客屏不被清空。
3. 进入选择收款方式后顾客屏不被清空。
4. 确认收款完成后顾客屏进入完成态 / 感谢页。
5. 不出现提前感谢页。
6. 不出现金额残留错误。

## 8. 不应发生

本轮不应出现：

- 新增提交 API。
- 新增数据库字段。
- 新增 migration。
- 改动 `/api/cashier/sales`。
- 改动 `/api/cashier/offline-sync`。
- 改动 records / dashboard 统计。
- 改动 KHQR 回调 / 查单。
