# Cashier Offline-01 测试指南

## 目标

验证 `/cashier` 第一阶段离线能力：

- 联网进入时缓存当前门店商品到 IndexedDB。
- 页面显示在线/离线状态。
- 页面显示商品缓存数量和缓存时间。
- 断网后只提示离线状态，不开放离线收银。

本阶段不包含离线订单保存、离线订单同步、离线 CASH 收银。

## 测试入口

使用完整门店收银台链接：

```text
https://elifekh.com/cashier?storeCode=ST169E7000
```

如果是本地开发：

```text
http://localhost:3000/cashier?storeCode=ST169E7000
```

## 联网缓存检查

1. 打开 `/cashier?storeCode=ST169E7000`。
2. 等待商品加载完成。
3. 左侧状态区应显示：
   - 网络状态：在线
   - 商品缓存：已缓存 X 个
   - 上次缓存时间：刚刚 / N 分钟前 / 具体时间

## DevTools IndexedDB 检查

Chrome / Edge：

1. 打开 DevTools。
2. 进入 Application。
3. 找到 IndexedDB。
4. 查看数据库：

```text
light_ops_cashier_offline
```

应看到：

- `cashier_products`
- `cashier_meta`

`cashier_products` 应包含当前门店商品快照。

`cashier_meta` 应包含：

- storeCode
- storeId
- tenantId
- lastProductCacheAt
- productCount
- cacheVersion
- deviceId

## 断网状态提示测试

1. 在 DevTools Network 中切换为 Offline，或断开电脑网络。
2. `/cashier` 左侧状态区应显示：
   - 网络状态：离线
   - 当前离线：本阶段仅支持查看已缓存商品，暂不支持离线收银
3. 本阶段不应提示“可以离线收银”。
4. 本阶段不应生成离线订单。

## 恢复网络测试

1. 将 Network 从 Offline 切回 Online。
2. 页面状态应恢复为“在线”。
3. 再次刷新 `/cashier?storeCode=ST169E7000` 后，商品缓存时间应更新。

## 收银主流程回归

联网状态下验证：

1. 商品选择正常。
2. CASH 收款正常。
3. KHQR 收款正常。
4. 完成销售后 `/records` 正常生成记录。
5. PWA 桌面打开仍能恢复最近门店。

## 当前不支持

Offline-01 不支持：

- 断网 CASH 收银。
- 离线订单保存。
- 离线订单同步。
- KHQR 离线确认。
- AI 拍照识别离线使用。
- 优惠券离线核销。
