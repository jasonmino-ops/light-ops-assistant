# Cashier-CheckoutFlow-01C-Fix03 测试说明

本文件用于验证电脑端 POS 新收银流程中，进入选择收款方式阶段后，顾客屏是否立即显示本单 KHQR 收款码。

## 范围

- 仅验证 `/desktop/pos` desktop-only 新流程。
- 不改数据库。
- 不改 `/api/cashier/sales`。
- 不改 KHQR 回调、查单或自动到账。
- 不改 `/sale`。
- 不改离线同步。

## 核心产品逻辑

进入选择收款方式阶段时，顾客屏默认显示本单 KHQR 收款码。

收银台中的 CASH / KHQR 按钮只决定最终 SaleRecord 的 `paymentMethod`：

- 顾客付现金时，选择 CASH，最终记录为 CASH。
- 顾客扫码付款时，选择 KHQR，最终记录为 KHQR。
- 选择 CASH 不会立刻清除顾客屏上的 KHQR 二维码。
- 只有确认收款完成销售后，顾客屏才进入完成态。

## 测试准备

同时打开两个页面：

员工端：

```text
/desktop/pos?storeCode=ST169E7000&lang=zh
```

顾客屏：

```text
/desktop/display?storeCode=ST169E7000&lang=zh
```

确保两个页面使用同一个 `storeCode`。

## 路径 1：进入 payment 阶段立即显示 KHQR

1. 在员工端选择一个商品。
2. 点击“确认本单”。
3. 点击“确认本单，选择收款方式”。
4. 不点击 CASH / KHQR 按钮，直接观察顾客屏。

预期：

- 顾客屏显示当前商品。
- 顾客屏显示本单应付金额。
- 顾客屏显示 KHQR 二维码。
- 顾客屏进入待支付 / 扫码支付状态。
- 二维码不会只在完成销售时一闪而过。

## 路径 2：选择 CASH 后不清除二维码

1. 进入 payment 阶段，确认顾客屏已显示 KHQR。
2. 点击“现金收款 CASH”。

预期：

- 收银台显示最终记账方式为 CASH。
- 顾客屏 KHQR 二维码可以继续显示。
- 商品和金额不丢失。

继续点击“确认现金已收款，完成销售”。

预期：

- 成功创建 CASH 销售记录。
- 购物车清空。
- 顾客屏进入完成态。
- `/records` 中该订单为 CASH。

## 路径 3：选择 KHQR 后完成销售

1. 进入 payment 阶段，确认顾客屏已显示 KHQR。
2. 点击“扫码收款 KHQR”。
3. 点击“确认 KHQR 已收款，完成销售”。

预期：

- 成功创建 KHQR 销售记录。
- 购物车清空。
- 顾客屏进入完成态。
- `/records` 中该订单为 KHQR。

## 路径 4：返回修改商品

1. 进入 payment 阶段，确认顾客屏已显示 KHQR。
2. 点击“返回修改商品”。
3. 修改商品或数量。
4. 再次点击“确认本单”。
5. 再次点击“确认本单，选择收款方式”。

预期：

- 返回修改商品后不会保留错误旧金额。
- 再次进入 payment 后，顾客屏显示新金额对应的 KHQR。
- 不出现旧订单二维码。

## 路径 5：非 desktop 回归

打开：

```text
/cashier?storeCode=ST169E7000&lang=zh
```

确认：

- 原 CASH 流程不变。
- 原 KHQR 流程不变。
- 原离线 CASH 流程不变。

打开：

```text
/sale
```

确认页面正常，不受本补丁影响。

## 通过标准

- 进入 payment 阶段即可看到顾客屏 KHQR 二维码。
- CASH / KHQR 最终记账方式正确。
- 选择 CASH 不会提前清掉顾客屏二维码。
- 确认收款后才进入完成态。
- 非 desktop `/cashier`、`/sale`、离线 CASH 不受影响。
