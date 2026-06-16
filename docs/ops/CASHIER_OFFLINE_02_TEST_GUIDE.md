# Cashier Offline-02 测试指南

## 目标

验证 `/cashier` 第二阶段离线能力：

- 断网时使用已缓存商品进行最小 CASH 收银。
- 离线订单保存到 IndexedDB 的 `cashier_offline_orders`。
- 页面显示待同步离线订单数量。
- 恢复网络后不自动同步。

本阶段不包含服务端同步接口，不会创建 SaleRecord，不会进入 `/records`。

## 前置：先缓存商品

1. 联网打开：

```text
https://elifekh.com/cashier?storeCode=ST169E7000
```

2. 等待商品加载完成。
3. 确认左侧状态区显示：
   - 网络状态：在线
   - 商品缓存：已缓存 X 个

## 断网进入离线模式

1. 打开 DevTools。
2. Network 切换为 Offline，或断开电脑网络。
3. 页面应显示：
   - 网络状态：离线
   - 离线收银模式：仅支持 CASH，本地保存，恢复网络后再同步。

如果没有商品缓存，应显示：

```text
当前无商品缓存，无法离线收银。
```

## 创建离线 CASH 订单

1. 在离线状态下点击已缓存商品。
2. 商品应能加入购物车。
3. 收款方式只能使用 CASH。
4. 点击完成销售。
5. 页面应提示：

```text
离线订单已保存，网络恢复后请同步
```

6. 当前购物车应被清空。
7. 左侧状态区“待同步离线订单”数量应 +1。

## IndexedDB 检查

Chrome / Edge：

1. 打开 DevTools。
2. 进入 Application。
3. 找到 IndexedDB：

```text
light_ops_cashier_offline
```

4. 查看：

```text
cashier_offline_orders
```

应看到离线订单，字段包括：

- offlineOrderId
- storeCode
- items
- totalAmount
- paymentMethod = CASH
- paymentStatus = PAID_OFFLINE
- syncStatus = PENDING

## 确认没有调用在线销售接口

断网创建离线订单时：

- 不应调用 `/api/cashier/sales` 成功创建线上记录。
- 不应在 `/records` 出现该离线订单。
- 不应显示已同步成功。

## 恢复网络测试

1. 将 Network 从 Offline 切回 Online。
2. 页面应恢复在线状态。
3. 如果存在待同步订单，应提示：

```text
有 X 笔离线订单待同步，下一阶段将支持上传同步
```

4. 本阶段不应自动上传。

## 在线流程回归

联网状态下验证：

1. 商品选择正常。
2. CASH 收款正常。
3. KHQR 收款正常。
4. 完成销售后 `/records` 正常生成记录。
5. PWA 桌面打开仍能恢复最近门店。

## 当前不支持

Offline-02 不支持：

- 自动同步离线订单。
- 手动上传离线订单。
- 服务端幂等同步。
- 离线 KHQR。
- 离线 AI 拍照识别。
- 离线优惠券核销。
- 离线退款。
