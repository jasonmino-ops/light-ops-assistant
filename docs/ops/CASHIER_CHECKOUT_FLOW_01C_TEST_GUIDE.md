# Cashier Checkout Flow 01C Test Guide

本指南用于验证 `/desktop/pos` desktop-only “确认本单 / 去结账”第一步 UI，不验证完整支付面板。

## 范围

- 只验证 `/desktop/pos` 模式。
- 不改交易逻辑。
- 不改 `/api/cashier/sales`。
- 不改 `/cashier` 非 desktop 模式。
- 不改 `/sale`。
- 不改离线 CASH 保存 / 同步。

## 打开电脑端 POS

打开：

```text
/desktop/pos?storeCode=ST169E7000&lang=zh
```

确认：

- 页面正常打开。
- 商品可见。
- 购物车为空时底部按钮禁用。

## 选择商品

1. 点击任意商品加入购物车。
2. 确认购物车显示商品。
3. 确认底部主按钮显示“确认本单”，不是“完成销售”。
4. 此时不应调用 `/api/cashier/sales`。

## 点击“确认本单”

1. 点击“确认本单”。
2. 页面进入本单确认视图。
3. 确认显示：
   - 商品摘要
   - 商品件数
   - 应付总额
   - “返回修改商品”
   - “确认本单，选择收款方式”
4. Network 中不应出现 `/api/cashier/sales`。
5. records 不应新增销售记录。

## 返回修改商品

1. 点击“返回修改商品”。
2. 页面回到商品选择阶段。
3. 购物车商品不丢失。
4. payment 状态不被强制改变。
5. 不调用提交 API。

## 进入占位下一步

1. 再次点击“确认本单”。
2. 点击“确认本单，选择收款方式”。
3. 页面显示“下一步将选择收款方式”占位。
4. 不创建 SaleRecord。
5. 不调用 `/api/cashier/sales`。

## 非 desktop `/cashier` 回归

打开：

```text
/cashier?storeCode=ST169E7000
```

确认：

- 原收款方式按钮仍显示。
- 原“完成销售”按钮仍显示。
- 原 CASH / KHQR 流程不变。

## `/sale` 回归

打开手机端或 Telegram 商户端 `/sale`。

确认：

- 页面不受本轮影响。
- 原销售流程不变。

## CASH / KHQR / 离线 CASH 影响确认

本轮不改提交逻辑，但仍需确认：

1. 非 desktop `/cashier` CASH 仍可完成销售。
2. 非 desktop `/cashier` KHQR 仍可完成销售。
3. 离线 CASH 仍使用既有本地保存逻辑。
4. `/desktop/pos` 本轮只进入确认/占位，不做完整支付。

## 通过标准

- `/desktop/pos` 不再在商品选择阶段直接暴露“完成销售”。
- “确认本单”只进入确认视图。
- “确认本单，选择收款方式”只进入占位下一步。
- 不创建 SaleRecord。
- 不调用 `/api/cashier/sales`。
- 非 desktop `/cashier` 和 `/sale` 不受影响。
