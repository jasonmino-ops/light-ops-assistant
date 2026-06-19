# Desktop-Display-KHQR-Focus-01A 测试说明

本文件用于验证电脑端 POS 选择“扫码收款 KHQR”后，顾客屏 `/desktop/display` 是否显示大二维码聚焦弹窗。

## 范围

- 只增强顾客屏展示体验。
- 不改数据库。
- 不新增 API。
- 不改 PosSession 字段结构。
- 不改 `/api/cashier/sales`。
- 不改 KHQR 回调、查单或自动到账。
- 不改 `/sale`。

## 触发规则

顾客屏分两层展示：

1. 常驻二维码区域：
   - 空闲态显示门店 KHQR。
   - payment 阶段显示本单 KHQR。

2. 大二维码聚焦弹窗：
   - 店员在 `/desktop/pos` payment 阶段点击“扫码收款 KHQR”后显示。
   - 使用现有 PosSession `message` 字段标记聚焦状态。
   - 不新增 API 或数据库字段。

## 路径 1：空闲页仍显示门店 KHQR

打开：

```text
/desktop/display?storeCode=ST169E7000&lang=zh
```

预期：

- 空闲页显示门店 KHQR。
- 不显示大二维码弹窗。
- 页面不报错。

## 路径 2：进入 payment 后常驻本单 KHQR

同时打开：

```text
/desktop/pos?storeCode=ST169E7000&lang=zh
/desktop/display?storeCode=ST169E7000&lang=zh
```

操作：

1. 添加商品。
2. 点击“确认本单”。
3. 点击“确认本单，选择收款方式”。

预期：

- 顾客屏显示本单商品和金额。
- 顾客屏常驻二维码区域显示本单 KHQR。
- 不显示大二维码弹窗。

## 路径 3：点击 KHQR 后弹出大二维码

在 payment 阶段：

1. 点击“扫码收款 KHQR”。

预期：

- 顾客屏中间弹出大二维码窗口。
- 弹窗显示“请扫码付款”。
- 弹窗显示本单金额。
- 大二维码明显大于常驻二维码。
- 不需要点击“确认 KHQR 已收款，完成销售”。

## 路径 4：选择 CASH 后关闭弹窗

操作：

1. 点击“扫码收款 KHQR”，确认大弹窗出现。
2. 点击“现金收款 CASH”。

预期：

- 大二维码弹窗关闭。
- 常驻二维码区域仍可显示本单 KHQR。
- 最终点击“确认现金已收款，完成销售”后，销售记录记为 CASH。

## 路径 5：KHQR 完成销售

操作：

1. 点击“扫码收款 KHQR”。
2. 顾客屏大二维码弹窗出现。
3. 点击“确认 KHQR 已收款，完成销售”。

预期：

- 弹窗关闭。
- 购物车清空。
- 顾客屏进入完成态 / 感谢页。
- `/records` 中该订单记录为 KHQR。
- 完成态结束后回到空闲页，显示门店 KHQR，不显示大弹窗。

## 路径 6：返回修改商品

操作：

1. 点击“扫码收款 KHQR”，确认弹窗出现。
2. 点击“返回修改商品”。
3. 修改商品或数量。
4. 再次进入 payment。
5. 再次点击“扫码收款 KHQR”。

预期：

- 返回修改商品后弹窗关闭。
- 旧金额不残留。
- 再次弹窗金额为新金额。

## 路径 7：非 desktop 回归

打开：

```text
/cashier?storeCode=ST169E7000&lang=zh
/sale
```

确认：

- 非 desktop `/cashier` 原 CASH / KHQR 流程不变。
- `/sale` 页面不受影响。
- 离线 CASH 不受影响。
