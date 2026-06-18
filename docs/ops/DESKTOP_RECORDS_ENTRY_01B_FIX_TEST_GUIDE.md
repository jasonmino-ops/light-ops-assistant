# Desktop-Records-Entry-01B 修复测试说明

## 目标

验证电脑端收银台 `/desktop/pos` 左侧“销售记录”入口在真实电脑浏览器中可用，并确保 `/records?from=desktop&storeCode=...` 只显示 URL 指定门店的销售记录。

本轮只修入口、门店隔离和 desktop 宽屏展示，不新增退款，不改 records 统计口径。

## 测试入口

员工端电脑收银台：

```text
/desktop/pos?storeCode=ST169E7000&lang=zh
```

销售记录页预期 URL：

```text
/records?storeCode=ST169E7000&from=desktop&lang=zh&returnTo=...
```

## 验证步骤

1. 打开 `/desktop/pos?storeCode=ST169E7000&lang=zh`。
2. 确认左侧 footer 中“接单看板 / 商品管理 / 销售记录”按钮点击区域明显大于手机端小文本链接。
3. 点击“销售记录”。
4. 确认进入 `/records`，且 URL 中包含：
   - `storeCode=ST169E7000`
   - `from=desktop`
   - `returnTo=...`
   - `lang=zh`
5. 确认页面不跳 Telegram 绑定页。
6. 确认 `/records` 标题显示当前门店信息或记录行店名为 `Mino Pet Shop`。
7. 确认返回的记录只属于 `ST169E7000` 对应门店，不显示其他商户记录。
8. 确认 desktop records 页面使用电脑端宽屏布局，不再是手机 Telegram 窄容器。
9. 确认 CASH / KHQR 记录显示正常。
10. 如果存在离线补同步订单，确认仍显示“离线补同步”标签。
11. 点击“返回收银台”。
12. 确认返回 `/desktop/pos?storeCode=ST169E7000&lang=zh`。

## 手机端回归

1. 从手机商户端正常进入 `/records`。
2. 确认原有登录态访问仍按当前用户 / 门店权限读取。
3. 确认手机端仍保持原移动端卡片宽度。
4. 确认筛选、详情弹层、CASH / KHQR / 离线补同步展示不受影响。

## 不应发生

- desktop records 被 Telegram session 当前门店覆盖。
- `storeCode=ST169E7000` 显示其他商户记录。
- 点击“销售记录”后丢失 `storeCode`。
- 点击“销售记录”后进入 Telegram 绑定页。
- 手机端 `/records` 变成 desktop 宽屏布局。
- 出现新增退款能力或退款入口变化。

## 保护边界

本轮不改：

- 数据库 schema / migration
- records 核心统计口径
- 退款逻辑
- `/cashier` 主收银链路
- `/api/cashier/sales`
- KHQR 回调 / 查单
- offline-sync API
- 离线收银保存 / 同步逻辑
- dashboard
