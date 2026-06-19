# Desktop-Display-KHQR-Idle-01A 测试说明

本文件用于验证顾客屏 `/desktop/display` 在等待页 / 空闲页常驻展示门店 KHQR 收款二维码。

## 范围

- 只修改顾客屏展示。
- 不改数据库。
- 不改 PosSession 协议。
- 不改 `/cashier` 完成销售逻辑。
- 不改 KHQR 回调、查单或自动到账。
- 不改 `/sale`。

## 产品逻辑

顾客屏展示优先级：

1. 当前订单待支付 KHQR：显示本单金额和本单 KHQR。
2. 空闲等待页：显示门店常驻 KHQR。
3. 未配置 KHQR：显示友好占位，不报错。

## 路径 1：空闲等待页展示门店 KHQR

打开：

```text
/desktop/display?storeCode=ST169E7000&lang=zh
```

在没有当前订单时确认：

- 页面正常显示等待态。
- 页面显示“门店收款码”。
- 页面显示 KHQR 二维码。
- 页面显示“支持 CASH / KHQR”提示。
- 刷新页面后仍正常显示。

## 路径 2：有订单时不被空闲 KHQR 干扰

同时打开：

```text
/desktop/pos?storeCode=ST169E7000&lang=zh
```

操作：

1. 在员工端添加商品。
2. 观察顾客屏。

预期：

- 顾客屏显示当前订单商品和金额。
- 空闲等待页不覆盖订单展示。
- 若进入 payment / KHQR 待支付态，优先显示本单 KHQR。

## 路径 3：完成销售后回到等待页

操作：

1. 完成一笔 CASH 或 KHQR 销售。
2. 观察顾客屏进入感谢页 / 完成态。
3. 等待完成态结束。

预期：

- 顾客屏回到等待页。
- 等待页继续显示门店 KHQR。
- 不保留旧订单商品或旧本单金额。

## 路径 4：没有 KHQR 配置的兜底

如能使用未配置 KHQR 的测试门店，打开：

```text
/desktop/display?storeCode=<NO_KHQR_STORE>&lang=zh
```

预期：

- 页面不崩溃。
- 门店收款码区域显示“暂未配置 KHQR 收款码”或等效占位。
- 后续有订单时，订单商品和金额展示不受影响。

如果没有可用测试门店，本项可通过代码取证确认：`PaymentCard` 在无 `storeKhqrImageUrl` 且无 session 时显示 `noStoreKhqr`。

## 回归检查

- `/desktop/pos` 选商品、确认本单、选择收款方式不受影响。
- 01C 完成销售不受影响。
- `/cashier` 原流程不受影响。
- `/sale` 不受影响。
- KHQR 回调 / 查单未改。
