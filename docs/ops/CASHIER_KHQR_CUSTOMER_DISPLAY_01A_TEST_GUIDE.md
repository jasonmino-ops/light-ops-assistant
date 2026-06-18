# Cashier-KHQR-CustomerDisplay-01A 测试指南

本指南用于验证电脑端 `/cashier` 选择 KHQR 收款时，顾客屏 `/desktop/display` 能显示当前订单金额和 KHQR 二维码。

## 当前边界

- 只验证顾客屏展示 KHQR。
- 不接 KHQR 自动回调。
- 不做自动查单。
- 员工端仍按现有 `/cashier` 完成销售逻辑人工确认。
- 不改离线收银：离线模式仍只允许 CASH。

## 准备

1. 员工端打开：
   `/cashier?storeCode=ST169E7000`
2. 顾客屏打开：
   `/desktop/display?storeCode=ST169E7000`
3. 两个页面保持同时打开。

## 验证步骤

### 1. 商品与金额同步

1. 在 `/cashier` 选择一个商品加入购物车。
2. 查看 `/desktop/display`：
   - 显示当前订单商品。
   - 显示本单应付金额。

### 2. KHQR 展示

1. 在 `/cashier` 收款方式选择 `KHQR`。
2. 查看 `/desktop/display`：
   - 显示本单应付金额。
   - 显示 KHQR 二维码或已配置的静态 KHQR 图片。
   - 显示 `请扫码付款 / Please scan to pay`。
   - 支付方式显示 KHQR。

### 3. 切回 CASH

1. 在 `/cashier` 收款方式切回 `现金`。
2. 查看 `/desktop/display`：
   - 当前订单仍可显示商品和金额。
   - 不再显示本单 KHQR 二维码。

### 4. 取消 / 清空订单

1. 在 `/cashier` 点击购物车 `清空`。
2. 查看 `/desktop/display`：
   - 不保留旧订单 KHQR。
   - 回到取消态或空闲态。

### 5. 完成销售

1. 在 `/cashier` 选择 KHQR 并点击完成销售。
2. 查看 `/desktop/display`：
   - 不保留旧 KHQR。
   - 进入完成态，随后回到空闲态。

### 6. 在线 CASH / KHQR 回归

1. 在线 CASH 收银应仍可完成销售。
2. 在线 KHQR 收银应仍按既有 `/cashier` 逻辑完成销售。
3. `/records` 应能看到销售记录。

### 7. 离线收银回归

1. 断网进入离线模式。
2. 确认只允许 CASH。
3. KHQR 不可用。
4. 离线 CASH 本地保存和待同步数量不受影响。

## 通过标准

- 顾客屏金额与员工端购物车金额一致。
- 员工选择 KHQR 后顾客屏显示 KHQR。
- 切回 CASH、清空购物车、完成销售后不保留旧 KHQR。
- 在线 CASH / KHQR 主流程不受影响。
- 离线 CASH 主流程不受影响。
